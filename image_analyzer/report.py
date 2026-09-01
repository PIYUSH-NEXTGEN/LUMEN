import pandas as pd
import json
from .models import ImageReport, DuplicateGroup, AnalysisResult


def find_brightest_darkest(reports: list[ImageReport]) -> tuple[ImageReport, ImageReport]:
    brightest = max(reports, key=lambda report: report.mean_brightness)
    darkest = min(reports, key=lambda report: report.mean_brightness)
    return brightest, darkest

def duplicate_summary(duplicates: list[DuplicateGroup],) -> dict[str, int]:
    duplicate_images = sum(len(group.files) for group in duplicates)
    redundant_images = sum(len(group.files) - 1 for group in duplicates)

    return {
        "duplicate_groups": len(duplicates),
        "duplicate_images": duplicate_images,
        "redundant_images": redundant_images,
    }

def export_csv(reports: list[ImageReport], duplicates: list[DuplicateGroup], path: str) -> None:
    duplicate_lookup = {}

    for group_id, group in enumerate(duplicates, start=1):
        for file in group.files:
            duplicate_lookup[file] = group_id
    data = []

    for report in reports:
        data.append({
            "filename": report.filename,
            "duplicate": report.filename in duplicate_lookup,
            "duplicate_group": duplicate_lookup.get(report.filename),

            "width": report.image_stats.shape[1],
            "height": report.image_stats.shape[0],
            "aspect_ratio": round(report.aspect_ratio, 4),
            "megapixels": round(report.megapixels, 6),
            "file_size_kb": round(report.file_size_kb, 2),
            "format": report.format,
            "mean": round(report.image_stats.mean, 2),
            "std": round(report.image_stats.std, 2),
            "minimum": report.image_stats.minimum,
            "maximum": report.image_stats.maximum,

            "red_mean": round(report.channel_stats.red.mean, 2),
            "green_mean": round(report.channel_stats.green.mean, 2),
            "blue_mean": round(report.channel_stats.blue.mean, 2),

            "red_dark_pct": round(report.histogram.red.dark_pct, 2),
            "red_mid_pct": round(report.histogram.red.mid_pct, 2),
            "red_bright_pct": round(report.histogram.red.bright_pct, 2),

            "green_dark_pct": round(report.histogram.green.dark_pct, 2),
            "green_mid_pct": round(report.histogram.green.mid_pct, 2),
            "green_bright_pct": round(report.histogram.green.bright_pct, 2),

            "blue_dark_pct": round(report.histogram.blue.dark_pct, 2),
            "blue_mid_pct": round(report.histogram.blue.mid_pct, 2),
            "blue_bright_pct": round(report.histogram.blue.bright_pct, 2),

            "mean_brightness": round(report.mean_brightness, 2),
            "luminance_brightness": round(report.luminance_brightness, 2),
            "contrast_score": round(report.contrast_score, 2),
            "sharpness_score": round(report.sharpness_score, 2),
            "colorfulness_score": round(report.colorfulness_score, 2),
            "underexposed_pct": round(report.underexposed_pct, 2),
            "overexposed_pct": round(report.overexposed_pct, 2),
            "entropy_score": round(report.entropy_score, 2),
            "dominant_colors": ", ".join(
                f"{color.color} ({round(color.percentage, 2)}%)"
                for color in report.dominant_colors
            ),

        })

    df = pd.DataFrame(data)
    df.to_csv(path, index=False)

def export_json(result: AnalysisResult, path: str) -> None:
    with open(path, "w") as file:
        json.dump(result.model_dump(), file, indent=4)

