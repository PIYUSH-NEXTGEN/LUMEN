import os

from image_analyzer.stats import image_stats, channel_stats
from image_analyzer.histogram import histogram
from image_analyzer.loader import load_image
from image_analyzer.duplicate import image_hash
from image_analyzer.models import ImageReport, HistogramStats
from image_analyzer.image_quality import (
    compute_luminance, luminance_brightness, contrast_score,
    sharpness_score, colorfulness_score, exposure_stats,
    entropy_score, dominant_colors,
    aspect_ratio, megapixels, file_size_kb,
)


def analyze_one(image_path: str, bins: int) -> ImageReport | None:
    try:
        arr, fmt = load_image(image_path)
        img_stats = image_stats(arr)
        ch_stats = channel_stats(arr)

        hist = HistogramStats(
            red=histogram(arr[:, :, 0], bins),
            green=histogram(arr[:, :, 1], bins),
            blue=histogram(arr[:, :, 2], bins),
        )

        luminance = compute_luminance(arr)
        underexposed, overexposed = exposure_stats(luminance)

        return ImageReport(
            filename=image_path,
            file_path=image_path,
            file_hash=image_hash(image_path),
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
            file_size_kb=file_size_kb(os.path.getsize(image_path)),
            format=fmt,
        )
    except Exception as error:
        return str(error)