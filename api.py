import io
import hashlib
import numpy as np
import config
import os
from PIL import Image as PILImage, UnidentifiedImageError
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
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


app = FastAPI(
    title="LUMEN API",
    description="Image analysis and quality assessment API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
allow_origins=[
    "https://lumen-image-analyzer.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
],
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/images")
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


@app.post("/analyze", response_model=ImageReport)
async def analyze_image(file: UploadFile = File(...), save_db: bool = False, session=Depends(get_db)):
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
        filename=file.filename,
        file_path=file.filename,
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


@app.get("/images/{image_id}")
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


@app.get("/images/{image_id}/histogram")
def get_histogram(image_id: int, session=Depends(get_db)):
    img = session.get(DBImage, image_id)
    if img is None:
        raise HTTPException(status_code=404, detail="Image not found")

    return img.histogram_regions


@app.delete("/images/{image_id}", status_code=204)
def delete_image(image_id: int, session=Depends(get_db)):
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


@app.get("/compare")
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


@app.get("/duplicates")
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


