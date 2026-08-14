import numpy as np
from config import HISTOGRAM_BINS, DARK_THRESHOLD, BRIGHT_THRESHOLD
from .models import RegionHistogram


def histogram(channel: np.ndarray, bins: int = 256) -> RegionHistogram:
    hist, _ = np.histogram(
        channel,
        bins=bins,
        range=(0, 256),
    )

    dark_end = int(DARK_THRESHOLD / 256 * bins)
    bright_start = int(BRIGHT_THRESHOLD / 256 * bins)

    dark = hist[:dark_end].sum()
    mid = hist[dark_end:bright_start].sum()
    bright = hist[bright_start:].sum()

    total = channel.size

    return RegionHistogram(
        dark_pct=float(dark / total * 100),
        mid_pct=float(mid / total * 100),
        bright_pct=float(bright / total * 100),
    )

