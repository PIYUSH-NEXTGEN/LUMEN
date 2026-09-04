import io
import hashlib
import os
import re
import secrets
import numpy as np
import config
from PIL import Image as PILImage, UnidentifiedImageError
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Request, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security.api_key import APIKeyHeader
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import nullslast


from image_analyzer.database.connection import SessionLocal
from image_analyzer.database.models import Image as DBImage
from image_analyzer.database.models import DuplicateGroup as DBDuplicateGroup
from image_analyzer.stats import image_stats, channel_stats
from image_analyzer.histogram import histogram
from image_analyzer.image_quality import (
    compute_luminance, luminance_brightness, contrast_score,
    sharpness_score, colorfulness_score, exposure_stats,
    entropy_score, dominant_colors,
    aspect_ratio, megapixels, file_size_kb, image_format,
    saturation_mean, warm_cool_bias,
)
from image_analyzer.models import ImageReport, HistogramStats


_IS_PRODUCTION = os.getenv("ENV", "development").strip().lower() in ("production", "prod")

app = FastAPI(
    title="LUMEN API",
    description="Image analysis and quality assessment API",
    version="1.0.0",
    # Keep interactive docs for local dev; disable them entirely in production
    # (ENV=production) so the API surface isn't publicly documented.
    docs_url=None if _IS_PRODUCTION else "/docs",
    redoc_url=None if _IS_PRODUCTION else "/redoc",
    openapi_url=None if _IS_PRODUCTION else "/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
allow_origins=[
    "https://lumen-image-analyzer.vercel.app",
],
    # Allow any local dev port (Vite dev server 5173, vite preview 4173, etc.)
    # so a locally running dashboard can always talk to a locally running API.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],  # includes the X-API-Key auth header used below
)


# --- API key authentication --------------------------------------------------
# Shared-secret auth: every client must send its key in the X-API-Key header.
# The key is never hardcoded — it comes from the API_KEY environment variable
# (see .env.example and the deployment notes in README.md).
API_KEY = os.getenv("API_KEY")
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def require_api_key(x_api_key: str | None = Security(_api_key_header)) -> None:
    """FastAPI dependency enforcing the shared-secret API key on every route."""
    if API_KEY is None:
        # Fail closed: if the server has no key configured, refuse everything
        # rather than silently serving an unauthenticated API.
        raise HTTPException(
            status_code=503,
            detail="API_KEY is not configured on the server. Set the API_KEY environment variable.",
        )
    if x_api_key is None or not secrets.compare_digest(x_api_key, API_KEY):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid API key. Send it in the X-API-Key header.",
        )


# --- Rate limiting (slowapi) --------------------------------------------------
# /analyze and DELETE /images/{id} are the expensive/destructive endpoints, so
# they are rate limited per client IP (see @limiter.limit below).
#
# Behind Render's reverse proxy, request.client.host is Render's internal
# proxy IP — every request would share one bucket. Render forwards the real
# client address in X-Forwarded-For, so we use that instead. The real client
# IP is the LAST entry (proxies append); earlier entries are client-supplied
# and spoofable, so only the last one is trusted.
def get_real_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=get_real_client_ip)
app.state.limiter = limiter  # required by slowapi's decorator machinery
# Return a clean JSON 429 instead of a bare exception when the limit is hit.
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


def get_db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@app.get("/")
def root():
    return {"status": "ok", "service": "LUMEN API"}


SORT_FIELDS = {
    "newest": (DBImage.analyzed_at, "desc"),
    "oldest": (DBImage.analyzed_at, "asc"),
    "name": (DBImage.filename, "asc"),
    "brightness": (DBImage.mean_brightness, "desc"),
    "dim": (DBImage.mean_brightness, "asc"),
}
DEFAULT_PAGE_SIZE = 24
MAX_PAGE_SIZE = 100


@app.get("/images", dependencies=[Depends(require_api_key)])
def fetch_images(limit: int = DEFAULT_PAGE_SIZE, offset: int = 0, q: str = "", sort: str = "newest", session=Depends(get_db)):
    """Paginated, sortable, searchable list of analyzed images.

    Returns {"items": [...], "total": int, "limit": int, "offset": int} so
    clients never need to load the whole table at once.
    """
    limit = max(1, min(limit, MAX_PAGE_SIZE))
    offset = max(0, offset)

    query = session.query(DBImage)
    if q:
        query = query.filter(DBImage.filename.ilike(f"%{q}%"))
    total = query.count()

    column, direction = SORT_FIELDS.get(sort, SORT_FIELDS["newest"])
    order = getattr(column, direction)()
    if sort in ("brightness", "dim"):
        order = nullslast(order)  # keep unmeasured records at the end either way

    images = (
        query
        .order_by(order, DBImage.id.desc())  # stable tie-break for pagination
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "items": [
            {
                "id": img.id,
                "filename": img.filename,
                "mean_brightness": img.mean_brightness,
                "luminance_brightness": img.luminance_brightness,
                "sharpness_score": img.sharpness_score,
                "contrast_score": img.contrast_score,
                "colorfulness_score": img.colorfulness_score,
                "width": img.width,
                "height": img.height,
                "format": img.format,
                "aspect_ratio": img.aspect_ratio,
                "dominant_colors": img.dominant_colors,
                "analyzed_at": img.analyzed_at,
            }
            for img in images
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


MAX_UPLOAD_BYTES = config.MAX_UPLOAD_MB * 1024 * 1024  # from config.MAX_UPLOAD_MB
PILImage.MAX_IMAGE_PIXELS = 100_000_000  # 100 MP — blocks decompression bombs

# Characters allowed in stored filenames; everything else becomes "_".
_FILENAME_UNSAFE_RE = re.compile(r"[^a-zA-Z0-9._-]")
MAX_FILENAME_LENGTH = 255  # matches Image.filename String(255) in the DB schema


def sanitize_filename(raw: str | None) -> str:
    """Return a filesystem- and DB-safe version of a client-supplied filename.

    Strips any path components (blocks traversal like "../../etc/passwd"),
    keeps only [a-zA-Z0-9._-] (replacing the rest with "_"), and caps the
    result at 255 characters so it always fits the DB column.
    """
    # Normalise backslashes to "/" first so directory components are stripped
    # on every OS (os.path.basename alone only handles the local separator).
    name = os.path.basename((raw or "").replace("\\", "/")).strip()
    name = _FILENAME_UNSAFE_RE.sub("_", name)
    name = name[:MAX_FILENAME_LENGTH].strip("._") or "unnamed"
    return name


@app.post("/analyze", response_model=ImageReport, dependencies=[Depends(require_api_key)])
@limiter.limit("10/minute")  # analysis is CPU-bound; 10/min per IP allows normal dashboard bursts but caps abuse
async def analyze_image(request: Request, file: UploadFile = File(...), save_db: bool = False, session=Depends(get_db)):
    # Never trust the browser-supplied filename: sanitize before it is used
    # anywhere (report fields, duplicate grouping, DB storage).
    safe_filename = sanitize_filename(file.filename)

    contents = bytearray()
    while chunk := await file.read(8192):
        contents.extend(chunk)
        if len(contents) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail=f"File too large. Max size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    contents = bytes(contents)

    try:
        pil_image = PILImage.open(io.BytesIO(contents))
        fmt = image_format(pil_image)
        pil_image = pil_image.convert("RGB")
    except UnidentifiedImageError:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid image.")

    arr = np.array(pil_image)

    img_stats = image_stats(arr)
    ch_stats = channel_stats(arr)

    hist = HistogramStats(
        red=histogram(arr[:, :, 0], config.HISTOGRAM_BINS),
        green=histogram(arr[:, :, 1], config.HISTOGRAM_BINS),
        blue=histogram(arr[:, :, 2], config.HISTOGRAM_BINS),
    )

    luminance = compute_luminance(arr)
    underexposed, overexposed = exposure_stats(luminance)

    report = ImageReport(
        filename=safe_filename,
        file_path=safe_filename,
        file_hash=hashlib.sha256(contents).hexdigest(),
        image_stats=img_stats,
        channel_stats=ch_stats,
        histogram=hist,
        mean_brightness=float(arr.mean()),
        luminance_brightness=luminance_brightness(luminance),
        contrast_score=contrast_score(luminance),
        sharpness_score=sharpness_score(luminance),
        colorfulness_score=colorfulness_score(arr),
        underexposed_pct=underexposed,
        overexposed_pct=overexposed,
        entropy_score=entropy_score(arr),
        dominant_colors=dominant_colors(arr),
        aspect_ratio=aspect_ratio(arr),
        megapixels=megapixels(arr),
        file_size_kb=file_size_kb(len(contents)),
        format=fmt,
        saturation_mean=saturation_mean(arr),
        warm_cool_bias=warm_cool_bias(arr),
    )

    if save_db:
        from image_analyzer.database.connection import save_to_db, save_duplicate_group
        from image_analyzer.models import DuplicateGroup as ReportDuplicateGroup

        save_to_db(report)

        matching = (
            session.query(DBImage)
            .filter(DBImage.file_hash == report.file_hash)
            .all()
        )

        if len(matching) >= 2:
            save_duplicate_group(ReportDuplicateGroup(
                hash=report.file_hash,
                files=[img.filename for img in matching],
            ))

    return report


@app.get("/images/{image_id}", dependencies=[Depends(require_api_key)])
def get_image(image_id: int, session=Depends(get_db)):
    img = session.get(DBImage, image_id)
    if img is None:
        raise HTTPException(status_code=404, detail="Image not found")

    return {
        "id": img.id,
        "filename": img.filename,
        "file_path": img.file_path,
        "file_hash": img.file_hash,
        "width": img.width,
        "height": img.height,
        "img_dtype": img.img_dtype,
        "mean_brightness": img.mean_brightness,
        "luminance_brightness": img.luminance_brightness,
        "contrast_score": img.contrast_score,
        "sharpness_score": img.sharpness_score,
        "colorfulness_score": img.colorfulness_score,
        "underexposed_pct": img.underexposed_pct,
        "overexposed_pct": img.overexposed_pct,
        "entropy_score": img.entropy_score,
        "aspect_ratio": img.aspect_ratio,
        "megapixels": img.megapixels,
        "file_size_kb": img.file_size_kb,
        "format": img.format,
        "saturation_mean": img.saturation_mean,
        "warm_cool_bias": img.warm_cool_bias,
        "channel_stats": img.channel_stats,
        "histogram_regions": img.histogram_regions,
        "dominant_colors": img.dominant_colors,
        "analyzed_at": img.analyzed_at,
    }


@app.get("/images/{image_id}/histogram", dependencies=[Depends(require_api_key)])
def get_histogram(image_id: int, session=Depends(get_db)):
    img = session.get(DBImage, image_id)
    if img is None:
        raise HTTPException(status_code=404, detail="Image not found")

    return img.histogram_regions


@app.delete("/images/{image_id}", status_code=204, dependencies=[Depends(require_api_key)])
@limiter.limit("5/minute")  # destructive; kept stricter than /analyze
def delete_image(request: Request, image_id: int, session=Depends(get_db)):
    img = session.get(DBImage, image_id)
    if img is None:
        raise HTTPException(status_code=404, detail="Image not found")

    group_id = img.duplicate_group_id

    session.delete(img)
    session.flush()

    if group_id is not None:
        remaining = (
            session.query(DBImage)
            .filter(DBImage.duplicate_group_id == group_id)
            .count()
        )
        if remaining == 0:
            group = session.get(DBDuplicateGroup, group_id)
            if group is not None:
                session.delete(group)

    session.commit()


@app.get("/compare", dependencies=[Depends(require_api_key)])
def compare_images(ids: str, session=Depends(get_db)):
    try:
        image_ids = [int(i) for i in ids.split(",")]
    except ValueError:
        raise HTTPException(status_code=400, detail="ids must be a comma-separated list of integers, e.g. ids=1,2,3")

    images = session.query(DBImage).filter(DBImage.id.in_(image_ids)).all()

    if not images:
        raise HTTPException(status_code=404, detail="No matching images found")

    return [
        {
            "id": img.id,
            "filename": img.filename,
            "mean_brightness": img.mean_brightness,
            "luminance_brightness": img.luminance_brightness,
            "contrast_score": img.contrast_score,
            "sharpness_score": img.sharpness_score,
            "colorfulness_score": img.colorfulness_score,
            "entropy_score": img.entropy_score,
            "underexposed_pct": img.underexposed_pct,
            "overexposed_pct": img.overexposed_pct,
            "saturation_mean": img.saturation_mean,
            "aspect_ratio": img.aspect_ratio,
            "warm_cool_bias": img.warm_cool_bias,
        }
        for img in images
    ]


@app.get("/duplicates", dependencies=[Depends(require_api_key)])
def list_duplicates(session=Depends(get_db)):
    groups = session.query(DBDuplicateGroup).all()
    result = []
    for group in groups:
        images = session.query(DBImage).filter(DBImage.duplicate_group_id == group.id).all()
        result.append({
            "group_id": group.id,
            "hash": group.hash,
            "images": [{"id": img.id, "filename": img.filename} for img in images],
        })
    return result


