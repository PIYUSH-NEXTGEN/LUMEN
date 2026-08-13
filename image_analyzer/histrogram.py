import numpy as np

from .models import RegionHistogram


def histogram(channel: np.ndarray) -> RegionHistogram:
    hist, _ = np.histogram(
        channel,
        bins=256,
        range=(0, 256),
    )

    dark = hist[0:85].sum()
    mid = hist[85:170].sum()
    bright = hist[170:256].sum()

    total = channel.size

    return RegionHistogram(
        dark_pct=float(dark / total * 100),
        mid_pct=float(mid / total * 100),
        bright_pct=float(bright / total * 100),
    )

