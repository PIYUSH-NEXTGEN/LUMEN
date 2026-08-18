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

def sharpness_score(arr: np.ndarray) -> float:
    red = arr[:, :, 0]
    green = arr[:, :, 1]
    blue = arr[:, :, 2]

    luminance = (
        0.299 * red
        + 0.587 * green
        + 0.114 * blue
    )

    center = luminance[1:-1, 1:-1]
    top = luminance[:-2, 1:-1]
    bottom = luminance[2:, 1:-1]
    left = luminance[1:-1, :-2]
    right = luminance[1:-1, 2:]

    laplacian = (
        4 * center - top - bottom - left - right
    )

    return float(laplacian.var())