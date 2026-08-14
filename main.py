import logging
import os

from image_analyzer.stats import image_stats, channel_stats
from image_analyzer.histogram import histogram
from image_analyzer.loader import load_image
from image_analyzer.models import ImageReport, HistogramStats
from image_analyzer.report import ( find_brightest_darkest,export_csv,export_json,)
from config import IMAGE_FOLDER, CSV_OUTPUT, JSON_OUTPUT

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


folder_path = IMAGE_FOLDER

image_files = []

for file in os.listdir(folder_path):
    if file.lower().endswith((".png", ".jpg", ".jpeg", ".bmp", ".gif")):
        image_files.append(os.path.join(folder_path, file))


reports = []

for image in image_files:
    try:
        logger.info("Analyzing image: %s", image)

        arr = load_image(image)

        img_stats = image_stats(arr)
        ch_stats = channel_stats(arr)

        r_hist = histogram(arr[:, :, 0])
        g_hist = histogram(arr[:, :, 1])
        b_hist = histogram(arr[:, :, 2])

        hist = HistogramStats(
            red=r_hist,
            green=g_hist,
            blue=b_hist,
        )

        mean_brightness = float(arr.mean())

        report = ImageReport(
            filename=image,
            image_stats=img_stats,
            channel_stats=ch_stats,
            histogram=hist,
            mean_brightness=mean_brightness,
        )

        reports.append(report)

        logger.info("Successfully analyzed: %s", image)

    except FileNotFoundError:
        logger.error("File not found: %s", image)

    except Exception as error:
        logger.error("Failed to analyze %s: %s", image, error)


if reports:
    brightest, darkest = find_brightest_darkest(reports)

    print("=" * 50)
    print(
        f"Brightest Image: {brightest.filename} "
        f"(Brightness: {brightest.mean_brightness:.2f})"
    )
    print(
        f"Darkest Image: {darkest.filename} "
        f"(Brightness: {darkest.mean_brightness:.2f})"
    )

    export_csv(reports, CSV_OUTPUT)
    export_json(reports, JSON_OUTPUT)

    logger.info("Results saved to image_results.csv")
    logger.info("Results saved to image_results.json")

else:
    logger.warning("No images were successfully analyzed.")