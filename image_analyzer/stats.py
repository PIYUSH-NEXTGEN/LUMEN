import numpy as np

from .models import ImageStats, ChannelStats, ChannelStatistics

def image_stats(arr: np.ndarray) -> ImageStats:
    return ImageStats(
        shape=arr.shape,
        dtype=str(arr.dtype),
        mean=float(arr.mean()),
        std=float(arr.std()),
        minimum=int(arr.min()),
        maximum=int(arr.max()),
    )


def channel_stats(arr: np.ndarray) -> ChannelStats:
    red = arr[:, :, 0]
    green = arr[:, :, 1]
    blue = arr[:, :, 2]

    return ChannelStats(
        red=ChannelStatistics(
            mean=float(red.mean()),
            std=float(red.std()),
            minimum=int(red.min()),
            maximum=int(red.max()),
        ),
        green=ChannelStatistics(
            mean=float(green.mean()),
            std=float(green.std()),
            minimum=int(green.min()),
            maximum=int(green.max()),
        ),
        blue=ChannelStatistics(
            mean=float(blue.mean()),
            std=float(blue.std()),
            minimum=int(blue.min()),
            maximum=int(blue.max()),
        ),
    )
