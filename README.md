# LUMEN

LUMEN is a small command-line image analysis tool intended for bulk inspection of image folders. It produces per-image metrics (brightness, contrast, sharpness, colorfulness, entropy, dominant colors), per-channel histograms, detects exact-file duplicates, and exports results as CSV and JSON.

### Stack
- Language(s): Python 3.9+
- Runtime / CLI framework: Typer (CLI)
- Notable libraries: numpy, pandas, pillow (PIL), pydantic

## Features
- Load common image formats (PNG, JPG, JPEG, BMP, GIF)
- Per-image statistics and per-channel histograms
- Image quality metrics: luminance, contrast, sharpness, colorfulness, entropy
- Dominant color extraction
- Exact-file duplicate detection (SHA-256)
- CSV and JSON exports suitable for analysis or reporting

## Project layout
```
README.md
pyproject.toml       - build and dependencies; installs `image-analyzer` console script
main.py              - CLI entrypoint (Typer), orchestrates analysis and exports
config.py            - runtime defaults (folders, thresholds, outputs)
image_analyzer/      - package with analysis modules
  loader.py          - image loading and conversion to RGB ndarray
  histogram.py       - histogram and region percentage calculations
  stats.py           - image-level and channel-level statistics
  image_quality.py   - brightness, contrast, sharpness, colorfulness, entropy, colors
  report.py          - CSV/JSON export and brightest/darkest reporting
  duplicate.py       - duplicate file detection by hashing
test/                - test assets and/or unit tests (if present)
LICENSE
```

How it fits together:
- The CLI in `main.py` scans a folder for image files, uses `loader` to read images into numpy arrays, computes stats and histograms via `stats.py` and `histogram.py`, runs image-quality analysis in `image_quality.py`, finds duplicates in `duplicate.py`, then writes CSV/JSON via `report.py`.

## Quickstart — run in three steps

1. Clone:
```bash
git clone https://github.com/PIYUSH-NEXTGEN/LUMEN.git
cd LUMEN
```

2. Create virtualenv and install:
```bash
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -e .
```

3. Run the analyzer:
```bash
# using the installed console script
image-analyzer --folder images --output image_results.csv --json-output image_results.json

# or run directly from source
python main.py --folder images --output image_results.csv --json-output image_results.json
```

Add `-v` or `--verbose` for debug logging:
```bash
image-analyzer --folder images -v
```

If you don't install the package, `python main.py` works because `main.py` exposes the same CLI.

## Configuration (defaults)
These defaults are defined in `config.py`:
- HISTOGRAM_BINS = 256
- DARK_THRESHOLD = 85
- BRIGHT_THRESHOLD = 170
- IMAGE_FOLDER = "images"
- CSV_OUTPUT = "image_results.csv"
- JSON_OUTPUT = "image_results.json"

Adjust thresholds or output paths via CLI options when running.

## Outputs
- CSV: a flat table with per-image metrics suitable for spreadsheets or data pipelines.
- JSON: structured export containing image reports and duplicate groups.
- Console: summary lines listing brightest and darkest images and basic duplicate group information.

## Tests
There is a `test/` directory — run tests with your preferred runner if tests are present. If the repository uses pytest, run:
```bash
pip install pytest
pytest -q
```

## Troubleshooting
- "Folder does not exist": confirm the `--folder` path and that it contains image files.
- Corrupt/unreadable images will be logged; the analyzer continues with remaining files.
- Duplicate detection is exact-file hashing (SHA-256). It does not detect visually similar images with different encodings or sizes.

