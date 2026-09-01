import os

import pytest
from PIL import Image

from analyzer import analyze_one


def test_analyze_one_metadata(tmp_path):
    path = tmp_path / "sample.png"
    Image.new("RGB", (100, 50), color=(128, 64, 32)).save(path)

    report = analyze_one(str(path), bins=256)

    assert not isinstance(report, str)
    assert report.aspect_ratio == pytest.approx(2.0)
    assert report.megapixels == pytest.approx(0.005)
    assert report.file_size_kb == pytest.approx(os.path.getsize(path) / 1024)
    assert report.format == "PNG"
