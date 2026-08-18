import numpy as np


def luminance_brightness(arr: np.ndarray) -> float:
    red = arr[:, :, 0]
    green = arr[:, :, 1]
    blue = arr[:, :, 2]

    luminance = (
        0.299 * red
        + 0.587 * green
        + 0.114 * blue
    )

    return float(luminance.mean())

def contrast_score(arr: np.ndarray) -> float:
    red = arr[:, :, 0]
    green = arr[:, :, 1]
    blue = arr[:, :, 2]

    luminance = (
        0.299 * red  + 0.587 * green  + 0.114 * blue
    )

    return float(luminance.std())