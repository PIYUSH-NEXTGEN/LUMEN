from .models import ImageReport

def find_brightest_darkest(reports: list[ImageReport]) -> tuple[ImageReport, ImageReport]:
    brightest = max(reports, key=lambda report: report.mean_brightness)
    darkest = min(reports, key=lambda report: report.mean_brightness)
    return brightest, darkest
