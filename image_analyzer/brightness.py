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

def colorfulness_score(arr: np.ndarray) -> float:
    maximum = arr.max(axis=2)
    minimum = arr.min(axis=2)

    color_difference = maximum - minimum
    return float(color_difference.mean())

def exposure_stats(arr: np.ndarray) -> tuple[float, float]:
    red = arr[:, :, 0]
    green = arr[:, :, 1]
    blue = arr[:, :, 2]

    luminance = (
        0.299 * red + 0.587 * green + 0.114 * blue
    )
    underexposed = (luminance < 20).mean() * 100
    overexposed = (luminance > 235).mean() * 100
    return float(underexposed), float(overexposed)