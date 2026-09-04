"""Tests for the API's filename sanitisation helper (api.sanitize_filename)."""

from api import sanitize_filename


def test_keeps_safe_characters():
    assert sanitize_filename("photo-2024_FINAL.png") == "photo-2024_FINAL.png"


def test_replaces_unsafe_characters():
    assert sanitize_filename("my image (1).png") == "my_image__1_.png"
    assert sanitize_filename("weird<>|name.jpg") == "weird___name.jpg"


def test_strips_path_traversal():
    assert sanitize_filename("../../etc/passwd") == "passwd"
    assert sanitize_filename("C:\\Users\\evil\\img.png") == "img.png"
    assert sanitize_filename("../../../.env") == "env"


def test_caps_length_at_255():
    long_name = "a" * 500 + ".png"
    result = sanitize_filename(long_name)
    assert len(result) == 255
    assert result.endswith(".png") or "." not in result  # truncation is allowed to cut the extension


def test_handles_empty_and_none():
    assert sanitize_filename("") == "unnamed"
    assert sanitize_filename(None) == "unnamed"
    assert sanitize_filename("///") == "unnamed"


def test_unicode_replaced():
    # é -> "_", existing "_" kept, ü -> "_"  =>  three underscores in a row
    assert sanitize_filename("café_über.png") == "caf___ber.png"
