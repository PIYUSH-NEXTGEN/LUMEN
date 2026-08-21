import logging
import os
import typer

from image_analyzer.stats import image_stats, channel_stats
from image_analyzer.histogram import histogram
from image_analyzer.loader import load_image
from image_analyzer.models import ImageReport, HistogramStats, AnalysisResult
from image_analyzer.report import find_brightest_darkest, export_csv, export_json,duplicate_summary
from image_analyzer.duplicate import find_duplicates
from image_analyzer.image_quality import (luminance_brightness, contrast_score,
                                          sharpness_score, colorfulness_score,
                                          exposure_stats, entropy_score , dominant_colors)


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def analyze(
    folder: str = typer.Option(..., "--folder", help="Folder containing images to analyze."),
    output: str = "results.csv",
    bins: int = typer.Option(256, min=1),
    verbose: bool = typer.Option(
    False,
    "--verbose",
    "-v",
    help="Enable detailed debug logging.",
    ),
):
    if verbose:
        logger.setLevel(logging.DEBUG)
    else:
        logger.setLevel(logging.INFO)

    if not os.path.isdir(folder):
        logger.error("Folder does not exist or is not a directory: %s", folder)
        raise typer.Exit(code=1)

    image_files = []

    for file in os.listdir(folder):
        if file.lower().endswith((".png", ".jpg", ".jpeg", ".bmp", ".gif")):
            image_files.append(os.path.join(folder, file))

    duplicates = find_duplicates(image_files)
    duplicate_info = duplicate_summary(duplicates)

    reports = []

    for image in image_files:
        try:
            logger.info("Analyzing image: %s", image)

            arr = load_image(image)
            logger.debug("Image loaded: shape=%s, dtype=%s", arr.shape, arr.dtype)

            img_stats = image_stats(arr)
            ch_stats = channel_stats(arr)

            r_hist = histogram(arr[:, :, 0], bins)
            g_hist = histogram(arr[:, :, 1], bins)
            b_hist = histogram(arr[:, :, 2], bins)

            hist = HistogramStats(
                red=r_hist,
                green=g_hist,
                blue=b_hist,
            )

            mean_brightness = float(arr.mean())
            perceptual_brightness = luminance_brightness(arr)
            contrast = contrast_score(arr)
            sharpness = sharpness_score(arr)
            colorfulness = colorfulness_score(arr)
            underexposed, overexposed = exposure_stats(arr)
            entropy = entropy_score(arr)
            dominant = dominant_colors(arr)

            report = ImageReport(
                filename=image,
                image_stats=img_stats,
                channel_stats=ch_stats,
                histogram=hist,
                mean_brightness=mean_brightness,
                luminance_brightness=perceptual_brightness,
                contrast_score=contrast,
                sharpness_score=sharpness,
                colorfulness_score=colorfulness,
                underexposed_pct=underexposed,
                overexposed_pct=overexposed,
                entropy_score=entropy,
                dominant_colors=dominant,
            )

            reports.append(report)

            logger.info("Successfully analyzed: %s \n", image)

        except FileNotFoundError:
            logger.error("File not found: %s", image)

        except Exception as error:
            logger.error("Failed to analyze %s: %s", image, error)

    if reports:
        logger.info(
            "Duplicate groups: %d, duplicate images: %d, redundant images: %d",
            duplicate_info["duplicate_groups"],
            duplicate_info["duplicate_images"],
            duplicate_info["redundant_images"],
        )

        for group in duplicates:
            logger.info("Duplicate group:")
            for file in group.files:
                logger.info("  %s\n", file)

        brightest, darkest = find_brightest_darkest(reports)

        result = AnalysisResult(
            reports=reports,
            duplicates=duplicates,
        )

        export_csv(reports, duplicates, output)
        export_json(result, "image_results.json")

        logger.info("Results saved to %s", output)
        logger.info("Results saved to image_results.json")

        print("=" * 50)
        print(
            f"Brightest Image: {brightest.filename} "
            f"(Brightness: {brightest.mean_brightness:.2f})"
        )
        print(
            f"Darkest Image: {darkest.filename} "
            f"(Brightness: {darkest.mean_brightness:.2f})"
        )

    else:
        logger.warning("No images were successfully analyzed.")

def cli():
    typer.run(analyze)

if __name__ == "__main__":
    typer.run(analyze)
