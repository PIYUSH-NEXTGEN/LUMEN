# LUMEN v3

LUMEN is an image analysis tool  usable as a CLI or a REST API that computes per-image and per-channel statistics, image-quality metrics (brightness, contrast, sharpness, colorfulness, entropy), dominant colors, and exact-duplicate detection, with optional persistence to PostgreSQL and export to CSV/JSON.

### Stack
- **Language:** Python 3.9+
- **Core libraries:** numpy, pandas, pillow (PIL), pydantic, typer
- **API:** FastAPI, uvicorn
- **Persistence:** PostgreSQL, SQLAlchemy, psycopg2, python-dotenv
- **Testing:** pytest

## Features
- Load common image formats (PNG, JPG, JPEG, BMP, GIF)
- Per-image statistics (shape, dtype, mean, std, min, max) and per-channel histograms
- Image quality metrics: luminance brightness, contrast, sharpness (Laplacian variance), colorfulness, entropy, exposure (under/overexposed %)
- Dominant color extraction
- Exact-file duplicate detection (SHA-256)
- CSV and JSON exports suitable for analysis or reporting
- Parallelized batch processing across CPU cores for faster analysis of large folders
- Analyzed images and duplicate groups persist to PostgreSQL, safely re-run without creating duplicate rows
- REST API for uploading and querying analysis results (via FastAPI)

## Project layout
```
README.md
pyproject.toml            - build config and dependencies; installs `image-analyzer` console script
main.py                    - CLI entrypoint (Typer), orchestrates parallel analysis and exports
analyzer.py                - single-image analysis pipeline (used by the CLI's worker pool)
api.py                     - FastAPI application exposing analysis over HTTP
config.py                  - runtime defaults (folders, thresholds, output paths, histogram bins)
image_analyzer/            - core package
  loader.py                 - image loading and conversion to RGB ndarray
  histogram.py               - histogram and dark/mid/bright region percentage calculations
  stats.py                    - image-level and channel-level statistics
  image_quality.py             - brightness, contrast, sharpness, colorfulness, entropy, exposure, dominant colors
  duplicate.py                  - exact duplicate detection via SHA-256 hashing
  report.py                      - CSV/JSON export and brightest/darkest reporting
  models.py                       - Pydantic schemas for all analysis results
  database/
    connection.py                 - SQLAlchemy engine/session, save/upsert logic
    models.py                      - SQLAlchemy ORM table definitions
    create_tables.py               - one-time table creation script
test/                       - pytest suite (stats, image quality, duplicates, DB round-trip)
LICENSE
```

**How it fits together:** `analyzer.py` holds the core single-image analysis pipeline. The CLI (`main.py`) scans a folder, runs that pipeline across images in parallel via `ProcessPoolExecutor`, optionally persists results to PostgreSQL, and writes CSV/JSON. The API (`api.py`) exposes the same analysis over HTTP, plus endpoints for listing, comparing, and inspecting previously analyzed images stored in the database.

---

## Setup Guide

### 1. Clone the repository
```bash
git clone https://github.com/PIYUSH-NEXTGEN/LUMEN.git
cd LUMEN
```

### 2. Create a virtual environment and install
```bash
python -m venv .venv
source .venv/bin/activate      # macOS/Linux
.venv\Scripts\activate         # Windows

pip install -e .
```

### 3. (Optional) Set up PostgreSQL for `--save-db` / the API
Only needed if you want analyzed results persisted to a database instead of (or alongside) CSV/JSON, or if you want to use the API's `/images`, `/compare`, and `/duplicates` endpoints.

1. Install PostgreSQL and create a database:
   ```sql
   CREATE DATABASE lumen_db;
   ```
2. Create a `.env` file in the project root:
   ```
   DB_USER=your_postgres_user
   DB_PASSWORD=your_postgres_password
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=lumen_db
   ```
3. Create the tables:
   ```bash
   python -m image_analyzer.database.create_tables
   ```

If you skip this step entirely, the CLI still works fully for CSV/JSON export, and the API's `/analyze` endpoint still works without saving — the database is optional.

---

## Usage — CLI

### Basic analysis (CSV + JSON export)
```bash
python main.py --folder images --output image_results.csv --json-output image_results.json
```
Images in the folder are analyzed in parallel across available CPU cores.

### Using the installed console script (after `pip install -e .`)
```bash
image-analyzer --folder images --output image_results.csv --json-output image_results.json
```

### With database persistence
```bash
python main.py --folder images --save-db
```
Re-running on the same folder **updates** existing rows (matched by file path) rather than creating duplicates. If PostgreSQL is unreachable, the CLI fails fast with a clear error before analyzing any images.

### Verbose/debug logging
```bash
python main.py --folder images -v
```

### Custom histogram bin count
```bash
python main.py --folder images --bins 128
```

### All CLI options at a glance
| Flag | Default | Description |
|---|---|---|
| `--folder` | `images` | Folder containing images to analyze |
| `--output` | `image_results.csv` | Path to save the CSV report |
| `--json-output` | `image_results.json` | Path to save the JSON report |
| `--bins` | `256` | Number of histogram bins |
| `--save-db` | off | Persist results to PostgreSQL |
| `-v` / `--verbose` | off | Enable debug-level logging |

---

## Usage — API

LUMEN's analysis pipeline is also available over HTTP for use by external tools or a frontend.

**Run the API server:**
```bash
uvicorn api:app --reload
```
Then visit `http://127.0.0.1:8000/docs` for interactive API documentation (Swagger UI), where every endpoint can be tried directly in the browser.

**Endpoints:**
| Method | Path | Description |
|---|---|---|
| GET | `/` | Health check |
| POST | `/analyze` | Upload an image, get back its full analysis report (optionally `?save_db=true` to persist it) |
| GET | `/images` | List all analyzed images stored in the database |
| GET | `/images/{id}` | Full stored report for one image |
| GET | `/images/{id}/histogram` | Histogram region data for one image |
| GET | `/compare?ids=1,2,3` | Compare metrics across multiple images |
| GET | `/duplicates` | List duplicate image groups |

Invalid uploads and malformed requests return clean `400`/`404` errors with a descriptive message rather than a generic server error.

---

## Configuration (defaults)
Defined in `config.py` and used as the CLI's default values above:
- `HISTOGRAM_BINS = 256`
- `DARK_THRESHOLD = 85`
- `BRIGHT_THRESHOLD = 170`
- `IMAGE_FOLDER = "images"`
- `CSV_OUTPUT = "image_results.csv"`
- `JSON_OUTPUT = "image_results.json"`

All can be overridden per-run via CLI flags without editing the file.

## Outputs
- **CSV** — a flat table with per-image metrics, suitable for spreadsheets or data pipelines.
- **JSON** — structured export containing full image reports and duplicate groups.
- **PostgreSQL** *(optional)* — one row per unique file path in an `images` table (JSONB columns for channel stats, histogram regions, and dominant colors), plus a `duplicate_groups` table linking images that share an identical hash.
- **Console** — summary lines listing the brightest and darkest images and duplicate group details.

## Performance
Batch analysis (`main.py`) distributes per-image analysis across CPU cores using `ProcessPoolExecutor`, so larger folders complete significantly faster than sequential processing. The API's `/analyze` endpoint processes a single uploaded image per request.

## Tests
```bash
pip install pytest
pytest -v
```
The suite covers image statistics, quality metrics, duplicate detection, and a PostgreSQL round-trip test. The database test automatically skips (rather than fails) if PostgreSQL isn't configured, so the full suite still runs cleanly without a database set up.

## Troubleshooting
- **"Folder does not exist or is not a directory"** — confirm the `--folder` path is correct and points to a real directory.
- **"Cannot connect to database"** — only relevant when using `--save-db`; check your `.env` values and that PostgreSQL is running. The CLI fails immediately with this message rather than attempting analysis first.
- Corrupt or unreadable images are logged and skipped (CLI) or return a clean `400` error (API); the analyzer continues with the remaining files in the folder.

## Limitations
- **Duplicate detection** currently uses exact byte-level hashing (SHA-256). It detects identical files only — a resized, recompressed, or re-saved copy of the same photo will *not* be flagged, since any byte change produces a different hash. Perceptual/near-duplicate hashing (e.g. average hash) is a possible future improvement.
- **Colorfulness score** is a simplified metric based on per-pixel max−min channel range. It is *not* the standard Hasler–Süsstrunk colorfulness metric used in computer vision literature, but a lightweight proxy for relative color variation.
- Database persistence stores the current state per file path only (no historical versioning) — re-analyzing a file updates its existing row rather than preserving prior analysis runs.

## Next updates
- Web frontend for upload, browsing, and visual comparison
- Deployed, publicly accessible version
