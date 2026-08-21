import numpy as np
from .models import DominantColor

def compute_luminance(arr: np.ndarray) -> np.ndarray:
    red, green, blue = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    return 0.299 * red + 0.587 * green + 0.114 * blue

def luminance_brightness(luminance: np.ndarray) -> float:
    return float(luminance.mean())

def contrast_score(luminance: np.ndarray) -> float:
    return float(luminance.std())

def sharpness_score(luminance: np.ndarray) -> float:
    center = luminance[1:-1, 1:-1]
    top = luminance[:-2, 1:-1]
    bottom = luminance[2:, 1:-1]
    left = luminance[1:-1, :-2]
    right = luminance[1:-1, 2:]
    laplacian = 4 * center - top - bottom - left - right
    return float(laplacian.var())

def colorfulness_score(arr: np.ndarray) -> float:
    maximum = arr.max(axis=2)
    minimum = arr.min(axis=2)

    color_difference = maximum - minimum
    return float(color_difference.mean())

def exposure_stats(luminance: np.ndarray) -> tuple[float, float]:
    underexposed = (luminance < 20).mean() * 100
    overexposed = (luminance > 235).mean() * 100
    return float(underexposed), float(overexposed)

def entropy_score(arr: np.ndarray) -> float:
    histogram, _ = np.histogram(arr, bins=256, range=(0, 256))

    probabilities = histogram / histogram.sum()
    probabilities = probabilities[probabilities > 0]

    entropy = -np.sum(
        probabilities * np.log2(probabilities)
    )
    return float(entropy)

def get_color_name(rgb: tuple[int, int, int]) -> str:
    red, green, blue = rgb

    if red < 40 and green < 40 and blue < 40:
        return "black"

    if red > 220 and green > 220 and blue > 220:
        return "white"

    if abs(red - green) < 20 and abs(green - blue) < 20:
        return "gray"

    if red > green * 1.5 and red > blue * 1.5:
        return "red"

    if green > red * 1.5 and green > blue * 1.5:
        return "green"

    if blue > red * 1.5 and blue > green * 1.5:
        return "blue"

    if red > 180 and green > 180 and blue < 100:
        return "yellow"

    if green > 150 and blue > 150 and red < 100:
        return "cyan"

    if red > 150 and blue > 150 and green < 100:
        return "magenta"

    return "other"

def dominant_colors(
    arr: np.ndarray,
    k: int = 5,
) -> list[DominantColor]:

    pixels = arr.reshape(-1, 3)
    quantized = (pixels // 32) * 32

    colors, counts = np.unique(
        quantized,
        axis=0,
        return_counts=True,
    )

    color_groups: dict[str, list[tuple[tuple[int, int, int], int]]] = {}

    for color, count in zip(colors, counts):
        rgb = (
            int(color[0]),
            int(color[1]),
            int(color[2]),
        )
        name = get_color_name(rgb)

        color_groups.setdefault(name, []).append(
            (rgb, int(count))
        )

    total_pixels = len(pixels)
    results = []

    for name, group in color_groups.items():
        total_count = sum(count for _, count in group)

        representative_rgb = max(
            group,
            key=lambda item: item[1],
        )[0]

        results.append(
            DominantColor(
                color=name,
                rgb=representative_rgb,
                percentage=round(
                    (total_count / total_pixels) * 100,
                    2,
                ),
            )
        )

    results.sort(
        key=lambda item: item.percentage,
        reverse=True,
    )
    return results[:k]