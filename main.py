import logging
import os
import typer
import config

from image_analyzer.database.connection import save_to_db, save_duplicate_group, check_db_connection
from image_analyzer.duplicate import find_duplicates, image_hash
from image_analyzer.stats import image_stats, channel_stats
from image_analyzer.histogram import histogram
from image_analyzer.loader import load_image
from image_analyzer.models import ImageReport, HistogramStats, AnalysisResult
from image_analyzer.report import find_brightest_darkest, export_csv, export_json,duplicate_summary
from image_analyzer.image_quality import (luminance_brightness, contrast_score,
                                          sharpness_score, colorfulness_score,
                                          exposure_stats, entropy_score ,
                                          dominant_colors, compute_luminance)



logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)



def analyze(
 folder: str = typer.Option(
        config.IMAGE_FOLDER, "--folder", help="Folder containing images to analyze."),

   output: str = typer.Option( config.CSV_OUTPUT, "--output", help="Path to save the CSV report."),

   json_output: str = typer.Option( config.JSON_OUTPUT, "--json-output", help="Path to save the JSON report."),

   bins: int = typer.Option( config.HISTOGRAM_BINS, "--bins", min=1, help="Number of histogram bins."),

   verbose: bool = typer.Option( False, "--verbose", "-v", help="Enable detailed debug logging.",),

   save_db: bool = typer.Option( False, "--save-db", help="Save analyzed images to PostgreSQL.",),

):
    if verbose:
        logger.setLevel(logging.DEBUG)
    else:
        logger.setLevel(logging.INFO)

    if not os.path.isdir(folder):
        logger.error("Folder does not exist or is not a directory: %s", folder)
        raise typer.Exit(code=1)

    if save_db:
        try:
            check_db_connection()
        except Exception as error:
            logger.error("Cannot connect to database: %s", error)
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
            luminance = compute_luminance(arr)
            perceptual_brightness = luminance_brightness(luminance)
            contrast = contrast_score(luminance)
            sharpness = sharpness_score(luminance)
            colorfulness = colorfulness_score(arr)
            underexposed, overexposed = exposure_stats(luminance)
            entropy = entropy_score(arr)
            dominant = dominant_colors(arr)

            report = ImageReport(
                filename=image,
                file_path=image,
                file_hash=image_hash(image),
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

            if save_db:
                save_to_db(report)
                logger.info("Saved to database: %s", image)

            logger.info("Successfully analyzed: %s \n", image)

        except FileNotFoundError:
            logger.error("File not found: %s", image)

        except Exception as error:
            logger.exception("Failed to analyze %s: %s", image, error)

    if save_db:
        for group in duplicates:
            save_duplicate_group(group)
            logger.info("Saved duplicate group: %s", group.hash)

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
        export_json(result, json_output)

        logger.info("Results saved to %s", output)
        logger.info("Results saved to %s", json_output)

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
