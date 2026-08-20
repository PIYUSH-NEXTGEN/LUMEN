import pandas as pd
import json
from .models import ImageReport, DuplicateGroup, AnalysisResult


def find_brightest_darkest(reports: list[ImageReport]) -> tuple[ImageReport, ImageReport]:
    brightest = max(reports, key=lambda report: report.mean_brightness)
    darkest = min(reports, key=lambda report: report.mean_brightness)
    return brightest, darkest

def duplicate_summary(
    duplicates: list[DuplicateGroup],
) -> dict[str, int]:
    return {
        "duplicate_groups": len(duplicates),
        "duplicate_files": sum(len(group.files) for group in duplicates),
    }

def export_csv(reports: list[ImageReport], path: str) -> None:
    data = []

    for report in reports:
        data.append({
            "filename": report.filename,

            "width": report.image_stats.shape[1],
            "height": report.image_stats.shape[0],
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
        })

    df = pd.DataFrame(data)
    df.to_csv(path, index=False)

def export_json(result: AnalysisResult, path: str) -> None:
    with open(path, "w") as file:
        json.dump(result.model_dump(), file, indent=4)

