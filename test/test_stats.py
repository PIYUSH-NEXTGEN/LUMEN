import numpy as np
import pytest
from image_analyzer.stats import image_stats
from image_analyzer.histogram import histogram
from image_analyzer.brightness import (luminance_brightness, contrast_score,
                                       sharpness_score, colorfulness_score, exposure_stats,)

test_array = np.array(
    [[[0, 0, 0], [255, 255, 255]]],
    dtype=np.uint8
)
histogram_array = np.array(
    [0, 50, 100, 150, 200, 255],
    dtype=np.uint8
)

def test_histogram():
    result = histogram(histogram_array)
    assert result.dark_pct == pytest.approx(33.33333333333333)
    assert result.mid_pct == pytest.approx(33.33333333333333)
    assert result.bright_pct == pytest.approx(33.33333333333333)


def test_image_stats():
    stats = image_stats(test_array)
    assert stats.shape == (1, 2, 3)
    assert stats.minimum == 0
    assert stats.maximum == 255
    assert stats.mean == pytest.approx(127.5)
    assert stats.std == pytest.approx(127.5)


def test_luminance_brightness():
    arr = np.array(
        [[[255, 0, 0]]],
        dtype=np.uint8
    )
    result = luminance_brightness(arr)
    assert result == pytest.approx(0.299 * 255)

def test_contrast_score():
    arr = np.array(
        [[[0, 0, 0], [255, 255, 255]]],
        dtype=np.uint8
    )
    result = contrast_score(arr)
    assert result == pytest.approx(127.5)

def test_sharpness_score():
    image = np.zeros((10, 10, 3), dtype=np.uint8)
    image[4:6, :] = 255
    score = sharpness_score(image)
    assert score > 0

def test_colorfulness_score():
    image = np.zeros((10, 10, 3), dtype=np.uint8)
    image[:, :, 0] = 255
    score = colorfulness_score(image)
    assert score == 255

def test_exposure_stats():
    image = np.zeros((10, 10, 3), dtype=np.uint8)
    underexposed, overexposed = exposure_stats(image)
    assert underexposed == 100
    assert overexposed == 0