import pytest
from image_analyzer.database.connection import SessionLocal, save_to_db, check_db_connection
from image_analyzer.database.models import Image
from image_analyzer.models import (
    ImageReport, ImageStats, ChannelStats, ChannelStatistics,
    HistogramStats, RegionHistogram, DominantColor,
)


def make_fake_report(path="test_roundtrip.png"):
    channel = ChannelStatistics(mean=100.0, std=10.0, minimum=0, maximum=255)
    region = RegionHistogram(dark_pct=10.0, mid_pct=80.0, bright_pct=10.0)
    return ImageReport(
        filename=path, file_path=path, file_hash="fake_hash_123",
        image_stats=ImageStats(shape=(10, 10, 3), dtype="uint8", mean=100.0, std=10.0, minimum=0, maximum=255),
        channel_stats=ChannelStats(red=channel, green=channel, blue=channel),
        histogram=HistogramStats(red=region, green=region, blue=region),
        mean_brightness=100.0, luminance_brightness=100.0, contrast_score=10.0,
        sharpness_score=5.0, colorfulness_score=20.0, underexposed_pct=0.0,
        overexposed_pct=0.0, entropy_score=4.0,
        dominant_colors=[DominantColor(color="gray", rgb=(100, 100, 100), percentage=100.0)],
    )


def test_save_to_db_roundtrip():
    try:
        check_db_connection()
    except Exception:
        pytest.skip("PostgreSQL not reachable — skipping DB integration test.")

    report = make_fake_report()
    saved = save_to_db(report)

    session = SessionLocal()
    try:
        fetched = session.get(Image, saved.id)
        assert fetched is not None
        assert fetched.file_path == "test_roundtrip.png"
        assert fetched.mean_brightness == 100.0
        assert fetched.dominant_colors[0]["color"] == "gray"
    finally:
        session.delete(session.get(Image, saved.id))
        session.commit()
        session.close()