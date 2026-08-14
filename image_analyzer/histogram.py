import numpy as np
from config import HISTOGRAM_BINS, DARK_THRESHOLD, BRIGHT_THRESHOLD
from .models import RegionHistogram


def histogram(channel: np.ndarray) -> RegionHistogram:
    hist, _ = np.histogram(
        channel,
        bins=HISTOGRAM_BINS,
        range=(0, 256),
    )

    dark =    hist[0:DARK_THRESHOLD].sum()
    mid =    hist[DARK_THRESHOLD:BRIGHT_THRESHOLD].sum()
    bright = hist[BRIGHT_THRESHOLD:HISTOGRAM_BINS].sum()

    total = channel.size

    return RegionHistogram(
        dark_pct=float(dark / total * 100),
        mid_pct=float(mid / total * 100),
        bright_pct=float(bright / total * 100),
    )

