import io
import hashlib
import numpy as np
import config
from PIL import Image as PILImage
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware



from image_analyzer.database.connection import SessionLocal
from image_analyzer.database.models import Image as DBImage
from image_analyzer.database.models import DuplicateGroup as DBDuplicateGroup
from image_analyzer.stats import image_stats, channel_stats
from image_analyzer.histogram import histogram
from image_analyzer.image_quality import (
    compute_luminance, luminance_brightness, contrast_score,
    sharpness_score, colorfulness_score, exposure_stats,
    entropy_score, dominant_colors,
)
from image_analyzer.models import ImageReport, HistogramStats


app = FastAPI(
    title="LUMEN API",
    description="Image analysis and quality assessment API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"status": "ok", "service": "LUMEN API"}


@app.get("/images")
def fetch_images():
    session = SessionLocal()
    try:
        images = session.query(DBImage).all()
        return [
            {
                "id": img.id,
                "filename": img.filename,
                "mean_brightness": img.mean_brightness,
                "luminance_brightness": img.luminance_brightness,
                "sharpness_score": img.sharpness_score,
                "analyzed_at": img.analyzed_at,
            }
            for img in images
        ]
    finally:
        session.close()


@app.post("/analyze", response_model=ImageReport)
async def analyze_image(file: UploadFile = File(...), save_db: bool = False):
    contents = await file.read()
    pil_image = PILImage.open(io.BytesIO(contents)).convert("RGB")
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
    )

    if save_db:
        from image_analyzer.database.connection import save_to_db
        save_to_db(report)
    return report


@app.get("/images/{image_id}")
def get_image(image_id: int):
    session = SessionLocal()
    try:
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
            "mean_brightness": img.mean_brightness,
            "luminance_brightness": img.luminance_brightness,
            "contrast_score": img.contrast_score,
            "sharpness_score": img.sharpness_score,
            "colorfulness_score": img.colorfulness_score,
            "underexposed_pct": img.underexposed_pct,
            "overexposed_pct": img.overexposed_pct,
            "entropy_score": img.entropy_score,
            "channel_stats": img.channel_stats,
            "histogram_regions": img.histogram_regions,
            "dominant_colors": img.dominant_colors,
            "analyzed_at": img.analyzed_at,
        }
    finally:
        session.close()


@app.get("/images/{image_id}/histogram")
def get_histogram(image_id: int):
    session = SessionLocal()
    try:
        img = session.get(DBImage, image_id)
        if img is None:
            raise HTTPException(status_code=404, detail="Image not found")

        return img.histogram_regions
    finally:
        session.close()


@app.get("/compare")
def compare_images(ids: str):
    image_ids = [int(i) for i in ids.split(",")]

    session = SessionLocal()
    try:
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
            }
            for img in images
        ]
    finally:
        session.close()


@app.get("/duplicates")
def list_duplicates():
    session = SessionLocal()
    try:
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
    finally:
        session.close()


