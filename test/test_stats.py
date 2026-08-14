import numpy as np
import pytest
from image_analyzer.stats import image_stats
from image_analyzer.histogram import histogram

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