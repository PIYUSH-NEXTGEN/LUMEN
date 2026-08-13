import pandas as pd
from .models import ImageReport


def find_brightest_darkest(reports: list[ImageReport]) -> tuple[ImageReport, ImageReport]:
    brightest = max(reports, key=lambda report: report.mean_brightness)
    darkest = min(reports, key=lambda report: report.mean_brightness)
    return brightest, darkest


def export_csv(reports: list[ImageReport], path: str) -> None:
    data = []
    for report in reports:
        data.append(report.model_dump())
    df = pd.DataFrame(data)
    df.to_csv(path, index=False)
