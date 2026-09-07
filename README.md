# LUMEN

A full stack image analyzer.

LUMEN analyzes brightness, contrast, sharpness, colorfulness, entropy, exposure, dominant colors, and exact duplicates. Results are available through a CLI, REST API, or web dashboard.

It started as a CLI tool and later gained a FastAPI backend and React dashboard, all using the same analysis pipeline.

> LUMEN is a learning and portfolio project 

## Stack

* **Python:** NumPy, Pandas, Pillow, Pydantic, Typer
* **API:** FastAPI, Uvicorn
* **Database:** PostgreSQL, SQLAlchemy, psycopg2
* **Frontend:** React 19, Vite, CSS
* **Testing:** pytest

## Features

* Supports PNG, JPG, JPEG, BMP, and GIF
* Image and channel statistics including mean, standard deviation, minimum, maximum, and histograms
* Brightness, contrast, sharpness, colorfulness, entropy, and exposure metrics
* Dominant color detection
* Exact duplicate detection using SHA-256
* CSV and JSON exports
* Parallel folder analysis using `ProcessPoolExecutor`
* Optional PostgreSQL storage with upsert by file path
* Searchable and paginated image gallery
* Side by side image comparison with metric results
* Full image analysis reports
* Image deletion
* First visit dashboard tour

## Project structure

```text
README.md
pyproject.toml
main.py                     CLI entrypoint
analyzer.py                 Core image analysis pipeline
api.py                      FastAPI application
config.py                   Application defaults

image_analyzer/
  loader.py                 Image loading and RGB conversion
  histogram.py              Histogram calculations
  stats.py                  Image and channel statistics
  image_quality.py          Quality and exposure metrics
  duplicate.py              SHA-256 duplicate detection
  report.py                 CSV/JSON exports and summaries
  models.py                 Pydantic models

  database/
    connection.py           Database connection and save logic
    models.py               SQLAlchemy models
    create_tables.py        Database setup

frontend/
  src/main.jsx              React dashboard
  src/styles.css            Main styles
  src/charts.css            Report and chart styles
  .env.example              Frontend environment variables

test/
  pytest test suite
```

`analyzer.py` is the core of LUMEN. It takes one image and returns one analysis report.

`main.py` runs that pipeline across a folder and exports the results.

`api.py` exposes the same pipeline through HTTP and provides the database endpoints.

The React dashboard communicates with the API and does not run the analysis itself.

## Setup

```bash
git clone https://github.com/PIYUSH-NEXTGEN/LUMEN.git
cd LUMEN

python -m venv .venv
source .venv/bin/activate
# Windows:
# .venv\Scripts\activate

pip install -e .
```

This is enough to run the CLI and generate CSV/JSON reports.

PostgreSQL is optional and only required for database persistence and gallery features.

### PostgreSQL

Create the database:

```sql
CREATE DATABASE lumen_db;
```

Copy `.env.example` to `.env`:

```env
DB_USER=your_postgres_user
DB_PASSWORD=your_postgres_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=lumen_db

API_KEY=
ENV=development
```

Create the tables:

```bash
python -m image_analyzer.database.create_tables
```

Generate an API key with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## CLI

Analyze a folder:

```bash
python main.py --folder images
```

Export CSV and JSON:

```bash
python main.py \
  --folder images \
  --output image_results.csv \
  --json-output image_results.json
```

Save results to PostgreSQL:

```bash
python main.py --folder images --save-db
```

### CLI options

| Flag              | Default              | Description                |
| ----------------- | -------------------- | -------------------------- |
| `--folder`        | `images`             | Folder to analyze          |
| `--output`        | `image_results.csv`  | CSV output path            |
| `--json-output`   | `image_results.json` | JSON output path           |
| `--bins`          | `256`                | Histogram bin count        |
| `--save-db`       | off                  | Save results to PostgreSQL |
| `-v`, `--verbose` | off                  | Enable debug logging       |

## API

Start the server:

```bash
uvicorn api:app --reload
```

Local Swagger documentation:

```text
http://127.0.0.1:8000/docs
```

### Endpoints

| Method | Endpoint                 | Description                      |
| ------ | ------------------------ | -------------------------------- |
| GET    | `/`                      | Health check                     |
| POST   | `/analyze`               | Analyze an uploaded image        |
| GET    | `/images`                | Search and paginate saved images |
| GET    | `/images/{id}`           | Get a stored image report        |
| GET    | `/images/{id}/histogram` | Get histogram data               |
| GET    | `/compare?ids=1,2,3`     | Compare multiple images          |
| GET    | `/duplicates`            | Get duplicate groups             |

`/analyze` accepts files up to 50 MB. Database saving is optional with `?save_db=true`.

## Authentication

All API routes except `/` require an `X-API-Key` header.

* Missing or incorrect key: `401`
* Server has no `API_KEY`: `503`
* `/` does not require authentication
* Swagger is available in development and disabled in production

The API uses one shared key. There are no user accounts or per-user galleries.

## Rate limiting

* `/analyze`: 10 requests per minute per IP
* `DELETE /images/{id}`: 5 requests per minute per IP

## Dashboard

```bash
cd frontend
npm install
npm run dev
```

The development server connects to `localhost:8000` by default.

For a production build:

```bash
npm run build
```

Set `VITE_API_BASE_URL` if the API is hosted elsewhere.

The dashboard provides:

* Image upload and analysis
* Separate Analyze and Save actions
* Searchable, paginated gallery
* Image comparison
* Full analysis reports
* Image deletion
* First visit guided tour

The gallery and comparison features require PostgreSQL.

## Configuration

Default values are defined in `config.py`:

```text
HISTOGRAM_BINS = 256
DARK_THRESHOLD = 85
BRIGHT_THRESHOLD = 170
IMAGE_FOLDER = "images"
CSV_OUTPUT = "image_results.csv"
JSON_OUTPUT = "image_results.json"
```

## Output

**CSV**

One row per image with analysis metrics.

**JSON**

Full image reports and duplicate groups.

**PostgreSQL**

Stored image reports, channel statistics, histogram regions, dominant colors, and duplicate groups.

**Console**

Brightest and darkest images plus duplicate groups.

## Performance

The CLI uses `ProcessPoolExecutor` to analyze multiple images across CPU cores.

The API processes one image per request and does not currently support batch uploads.

## Tests

```bash
pip install pytest
pytest -v
```

The test suite covers statistics, quality metrics, duplicate detection, filename sanitization, and database operations.

Database tests are skipped when PostgreSQL is not configured.

Check the frontend build with:

```bash
cd frontend
npm run build
```

## Limitations

* **Exact duplicates only.** SHA-256 detects identical files. Resizing or recompressing an image creates a different hash.
* **No image understanding.** LUMEN measures pixels and does not detect objects, recognize scenes, or generate captions.
* **No EXIF analysis.** Camera, lens, GPS, exposure, and timestamp data are not read.
* **Simplified colorfulness metric.** LUMEN uses a channel range based calculation rather than the Hasler-Süsstrunk metric.
* **Metric comparison only.** Comparing images does not measure visual or perceptual similarity.
* **No analysis history.** Re-analyzing a file updates its current record instead of keeping previous results.
* **Shared gallery.** The current authentication system has one shared API key and no per-user data isolation.


