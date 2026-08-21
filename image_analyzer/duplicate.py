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
