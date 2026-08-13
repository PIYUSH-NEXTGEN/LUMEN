import os

from image_analyzer.stats import image_stats, channel_stats
from image_analyzer.histogram import histogram
from image_analyzer.loader import load_image
from image_analyzer.report import find_brightest_darkest, export_csv, export_json
from image_analyzer.models import ImageReport, HistogramStats

folder_path = "images"

image_files = []

for file in os.listdir(folder_path):
    if file.lower().endswith((".png", ".jpg", ".jpeg")):
        image_files.append(os.path.join(folder_path, file))


reports = []

for image in image_files:
    arr = load_image(image)

    img_stats = image_stats(arr)
    ch_stats = channel_stats(arr)

    r_hist = histogram(arr[:, :, 0])
    g_hist = histogram(arr[:, :, 1])
    b_hist = histogram(arr[:, :, 2])

    hist = HistogramStats(
        red=r_hist,
        green=g_hist,
        blue=b_hist
    )

    mean_brightness = float(arr.mean())

    report = ImageReport(
        filename=image,
        image_stats=img_stats,
        channel_stats=ch_stats,
        histogram=hist,
        mean_brightness=mean_brightness
    )

    reports.append(report)

brightest, darkest = find_brightest_darkest(reports)

print("-" * 50)
print(
    f"Brightest Image: {brightest.filename} "
    f"(Brightness: {brightest.mean_brightness:.2f})"
)
print(
    f"Darkest Image: {darkest.filename} "
    f"(Brightness: {darkest.mean_brightness:.2f})\n"
)

export_csv(reports, "image_results.csv")
print("| Results saved to 'image_results.csv' |")

export_json(reports, "image_results.json")
print("| Results saved to 'image_results.json' |\n")


for report in reports:
    print(f"Filename: {report.filename}")
    print(f"Brightness: {report.mean_brightness:.2f}")
    print(f"Shape: {report.image_stats.shape}")
    print(f"Mean: {report.image_stats.mean:.2f}")
    print(f"Std: {report.image_stats.std:.2f}")
    print("-" * 50)