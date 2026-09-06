# LUMEN
A full stack image analyzer tool

LUMEN analyzes images  brightness, contrast, sharpness, colorfulness, entropy, exposure, dominant colors, exact-duplicate detection  and gives you the results as a CLI report, a REST API response, or a web dashboard you can click through. It started as a CLI tool and then a FastAPI layer with a React frontend on top, so all three interfaces run off the same core analysis pipeline.

This is a learning-stage project. It works, it's deployed

## Stack

- Python 3.9+ — numpy, pandas, Pillow, pydantic, Typer
- FastAPI + uvicorn for the API
- PostgreSQL via SQLAlchemy + psycopg2 
- React 19 + Vite for the dashboard, CSS
- pytest for the Python side, `npm run build` as the frontend's compile check

## What it actually does

- Loads PNG/JPG/JPEG/BMP/GIF and runs per-image and per-channel stats: shape, dtype, mean, std, min, max, plus full histograms
- Computes quality metrics: luminance brightness, contrast (via Laplacian variance for sharpness), colorfulness, entropy, exposure (% under/overexposed), aspect ratio, megapixels, mean saturation, warm/cool bias
- Pulls dominant colors out of each image
- Flags exact duplicates by SHA-256 — same bytes, same hash, that's the whole check (more on what this doesn't catch below)
- Exports to CSV and JSON
- Batches folders across CPU cores with `ProcessPoolExecutor` so a few hundred images doesn't mean a coffee break
- Persists to Postgres if you want it, upserting by file path so re-running the same folder doesn't create duplicate rows
- Dashboard: upload, browse a searchable paginated gallery, compare images side-by-side with win/loss markers per metric, inspect a full report, delete records, and a short guided tour on first visit

## Layout

```
README.md
pyproject.toml            build config, deps, installs the `image-analyzer` console script
main.py                    CLI entrypoint (Typer) — parallel analysis, exports
analyzer.py                the actual per-image analysis pipeline, used by CLI workers
api.py                     FastAPI app — same pipeline, over HTTP
config.py                  defaults: folders, thresholds, output paths, histogram bins
image_analyzer/
  loader.py                  image loading + RGB ndarray conversion
  histogram.py                histograms, dark/mid/bright region percentages
  stats.py                     image- and channel-level statistics
  image_quality.py              brightness/contrast/sharpness/colorfulness/entropy/exposure/dominant colors
  duplicate.py                   SHA-256 exact-duplicate detection
  report.py                       CSV/JSON export, brightest/darkest summary
  models.py                        pydantic schemas
  database/
    connection.py                  engine/session, save/upsert logic
    models.py                       ORM table definitions
    create_tables.py                 one-time schema setup
frontend/                  React dashboard (Vite)
  src/main.jsx                the whole dashboard — routing, analyzer, gallery, comparison, static pages
  src/styles.css               main styles
  src/charts.css                chart/report styles
  .env.example                  VITE_API_BASE_URL, VITE_API_KEY templates
test/                      pytest suite
```

`analyzer.py` is the core  one image in, one report out. `main.py` fans that out across a folder in parallel and writes CSV/JSON. `api.py` exposes the same pipeline over HTTP and adds the endpoints for listing, comparing, and deleting whatever's been saved. The dashboard is just a client of that API  it doesn't touch the analysis code directly.

---

## Setup

```bash
git clone https://github.com/PIYUSH-NEXTGEN/LUMEN.git
cd LUMEN
python -m venv .venv
source .venv/bin/activate      # .venv\Scripts\activate on Windows
pip install -e .
```

That's enough to run the CLI and get CSV/JSON output. Postgres and the API's gallery features are optional on top of that.

### Postgres (optional — needed for `--save-db` and most of the API)

```sql
CREATE DATABASE lumen_db;
```

Copy `.env.example` to `.env` and fill it in:

```
DB_USER=your_postgres_user
DB_PASSWORD=your_postgres_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=lumen_db

# every API route needs this except the health check — sent as the X-API-Key header
# generate one with: python -c "import secrets; print(secrets.token_urlsafe(32))"
API_KEY=

# "development" (default) keeps /docs on; "production" turns it off
ENV=development
```

Then:

```bash
python -m image_analyzer.database.create_tables
```

Skip all of this and the CLI still exports CSV/JSON fine, and `/analyze` still works without saving — Postgres only gates persistence and the gallery-dependent endpoints.

---

## CLI

```bash
python main.py --folder images --output image_results.csv --json-output image_results.json
```

Runs across all CPU cores automatically. If you installed with `pip install -e .`, you also get a console script:

```bash
image-analyzer --folder images --output image_results.csv --json-output image_results.json
```

With persistence:

```bash
python main.py --folder images --save-db
```

Re-running the same folder updates existing rows by file path instead of duplicating them. If Postgres isn't reachable, this fails immediately with a clear error, before it burns time analyzing anything.

| Flag | Default | What it does |
|---|---|---|
| `--folder` | `images` | folder to scan |
| `--output` | `image_results.csv` | CSV output path |
| `--json-output` | `image_results.json` | JSON output path |
| `--bins` | `256` | histogram bin count |
| `--save-db` | off | persist to Postgres |
| `-v` / `--verbose` | off | debug logging |

---

## API

```bash
uvicorn api:app --reload
```

`/docs` gives you Swagger UI locally (disabled in production — see auth section below).

| Method | Path | What it returns |
|---|---|---|
| GET | `/` | health check, no auth required |
| POST | `/analyze` | full analysis report for an uploaded image; add `?save_db=true` to persist it |
| GET | `/images` | paginated gallery — `?limit=` (default 24, max 100), `?offset=`, `?sort=` (`newest`/`oldest`/`name`/`brightness`/`dim`), `?q=` for filename search |
| GET | `/images/{id}` | full stored report for one image |
| GET | `/images/{id}/histogram` | histogram region data for one image |
| GET | `/compare?ids=1,2,3` | metrics side by side across multiple images |
| GET | `/duplicates` | duplicate groups |

`/analyze` rejects anything over 50 MB with a 413 (`config.MAX_UPLOAD_MB`), and the dashboard checks size client-side before it even tries. `/images` is paginated on purpose — no endpoint here will ever hand you the whole table in one response. `?save_db=true` is opt-in: without it, `/analyze` gives you the report and keeps nothing. The dashboard splits this into two buttons, Analyze and Save to gallery, so it's an explicit choice rather than something that happens silently.

### Auth

Every route except `/` requires an `X-API-Key` header matching the server's `API_KEY` environment variable.

- No `API_KEY` set on the server → every protected route fails closed with `503`, rather than quietly running open.
- Wrong or missing header → `401`.
- The dashboard reads its copy from `VITE_API_KEY` at build time and attaches it to every request.

Worth being upfront about what this is and isn't: it's a single shared secret, not per-user auth. It stops opportunistic scanning and scripted abuse hitting the API directly — it does not stop someone who opens the deployed site's dev tools, since the key has to be sent from the browser to work at all. There's no concept of a logged-in user here, and no per-person data isolation; everyone using the dashboard shares one gallery. That's a real limitation, not an oversight — see Limitations.

Generate a key with:
```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Rate limiting

`/analyze` is capped at 10 requests/minute per IP, `DELETE /images/{id}` at 5/minute — both tracked off the real client IP via `X-Forwarded-For`, not the reverse proxy's. Plenty of headroom for normal dashboard use, tight enough to stop a script from hammering the CPU-bound analysis path or mass-deleting records.

---

## Dashboard

```bash
cd frontend
npm install
npm run dev       # talks to localhost:8000 by default
npm run build     # production build, dist/
```

Point it elsewhere with `VITE_API_BASE_URL` in `frontend/.env.example`. Client-side upload validation, separate Analyze/Save actions, searchable paginated gallery, side-by-side comparison with per-metric win/loss markers, full report view, deletion, a first-visit tour. Gallery and comparison need Postgres configured on the backend; raw analysis doesn't.

---

## Config defaults

Set in `config.py`, all overridable via CLI flags:

- `HISTOGRAM_BINS = 256`
- `DARK_THRESHOLD = 85`
- `BRIGHT_THRESHOLD = 170`
- `IMAGE_FOLDER = "images"`
- `CSV_OUTPUT = "image_results.csv"`
- `JSON_OUTPUT = "image_results.json"`

## Output formats

- **CSV** — flat table, one row per image, spreadsheet-friendly
- **JSON** — full reports plus duplicate groups
- **Postgres** *(optional)* — one row per unique file path in `images` (JSONB for channel stats, histogram regions, dominant colors), plus a `duplicate_groups` table
- **Console** — brightest/darkest summary, duplicate group listing

## Performance

The CLI parallelizes across CPU cores with `ProcessPoolExecutor`, so batch folders scale with your machine. The API processes one image per request — there's no batch upload endpoint.

## Tests

```bash
pip install pytest
pytest -v
```

Covers stats, quality metrics, duplicate detection, filename sanitization, and a Postgres round-trip. The DB test skips (not fails) if Postgres isn't configured, so the suite runs clean without a database. `cd frontend && npm run build` is the frontend's equivalent check — if it compiles, the build is sound.

## Troubleshooting

- **"Folder does not exist or is not a directory"** — check the `--folder` path.
- **"Cannot connect to database"** — only comes up with `--save-db`; check `.env` and that Postgres is actually running. Fails before analyzing anything, not partway through.
- **Dashboard gallery is empty / saves fail** — Postgres needs to be configured on the API (see setup). Analysis without saving works regardless.
- **401 from the API** — `X-API-Key` header missing or wrong. **503** means the server itself has no `API_KEY` set — that's a deployment problem, not a client one.
- Corrupt/unreadable images are skipped and logged (CLI) or return a `400` (API); the rest of the batch keeps going either way.

## Limitations

Being direct about what this doesn't do, rather than letting you find out the hard way:

- **Duplicate detection is exact-byte only.** SHA-256 catches identical files, full stop. Resize, recompress, or re-save the same photo and it's a different hash — no duplicate flag. Perceptual hashing (average hash, pHash) would fix this and isn't implemented yet.
- **No content understanding.** This measures pixels, not subjects. No object detection, no captions, no tags — it doesn't know or care what's in the photo.
- **No EXIF.** Camera, lens, exposure settings, GPS, timestamps — none of it is read. Pixel data only.
- **Colorfulness is a simplified proxy** (per-pixel max−min channel range), not the Hasler–Süsstrunk metric you'll see cited in computer vision papers. Don't compare these numbers against tools that use the real thing.
- **Comparison is numbers, not eyes.** Side-by-side metrics with win/loss markers — not a perceptual or visual similarity check.
- **No history.** Persistence is current-state-per-file-path only; re-analyzing overwrites the existing row rather than keeping past runs.
- **No per-user data.** One shared API key, one shared gallery — anyone with dashboard access sees everything anyone else uploaded. There's no login system and no per-user isolation. Fine for a single-person or trusted-group setup; not fine if you're expecting anything resembling privacy between users.

