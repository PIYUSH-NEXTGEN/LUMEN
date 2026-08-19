import hashlib
from .models import DuplicateGroup


def image_hash(path: str) -> str:
    with open(path, "rb") as file:
        return hashlib.sha256(file.read()).hexdigest()

def find_duplicates(paths: list[str]) -> list[DuplicateGroup]:
    hashes: dict[str, list[str]] = {}

    for path in paths:
        file_hash = image_hash(path)

        if file_hash not in hashes:
            hashes[file_hash] = []

        hashes[file_hash].append(path)

    return [
        DuplicateGroup(hash=file_hash, files=files)
        for file_hash, files in hashes.items()
        if len(files) > 1
    ]

def test_find_duplicates(tmp_path):
    image1 = tmp_path / "image1.jpg"
    image2 = tmp_path / "image2.jpg"
    image3 = tmp_path / "image3.jpg"

    image1.write_bytes(b"same image")
    image2.write_bytes(b"same image")
    image3.write_bytes(b"different image")

    duplicates = find_duplicates([
        str(image1),
        str(image2),
        str(image3),
    ])

    assert len(duplicates) == 1
    assert set(duplicates[0].files) == {
        str(image1),
        str(image2),
    }