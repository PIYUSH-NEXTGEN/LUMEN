# Contributing to LUMEN

Thanks for your interest in improving LUMEN — an image analysis tool usable as a CLI, a REST API, and a small React frontend. This guide covers setting up a development environment, the project's coding style expectations, and how to submit changes or report problems.

## Development environment

Full setup instructions live in the [README setup guide](README.md#setup-guide). The short version:

1. **Python 3.9+** — create and activate a virtual environment, then install in editable mode:

   ```bash
   python -m venv .venv
   # Windows:
   .venv\Scripts\activate
   # macOS/Linux:
   source .venv/bin/activate

   pip install -e .
   ```

2. **Frontend** — Node.js 18+:

   ```bash
   cd frontend
   npm install
   ```

3. **PostgreSQL (optional)** — only needed for `--save-db`, the API's persistence features, and the `/images`, `/compare`, and `/duplicates` endpoints. Configure the connection via `.env` as described in the README. Everything else (CLI analysis, CSV/JSON export, `POST /analyze`) works without a database.

## Running locally

| What | Command |
|---|---|
| CLI analysis | `python main.py --folder images --output image_results.csv --json-output image_results.json` |
| API server | `uvicorn api:app --reload` (interactive docs at `http://127.0.0.1:8000/docs`) |
| Frontend dev server | `cd frontend && npm run dev` |

By default the frontend talks to `http://localhost:8000`; point it elsewhere with the `VITE_API_BASE_URL` environment variable.

## Running the tests

```bash
pytest                 # Python: stats, image quality, duplicates, DB round-trip
cd frontend
npm run build          # verifies the React app compiles cleanly
```

If you have [ruff](https://github.com/astral-sh/ruff) installed, `ruff check .` is a quick lint pass before opening a PR.

## Coding style expectations

### Python (backend / core)

- Keep analysis logic as **small, pure, vectorized NumPy functions** inside `image_analyzer/`; orchestration lives in `analyzer.py`, `main.py`, and `api.py`.
- Use type hints on public functions and keep docstrings short and factual.
- Match the existing formatting: 4-space indents, double quotes, f-strings for interpolation.
- **Add or extend tests in `test/`** for any new metric, parser, or DB behavior — bug fixes should come with a regression test.
- Don't add new dependencies without discussing them in an issue first.

### JavaScript / React (frontend)

- **Function components and hooks only** — no class components (the one exception is the top-level `ErrorBoundary`, which React requires to be a class), no new UI libraries.
- Components currently live in `frontend/src/main.jsx`; keep new components there unless the file is being deliberately split.
- Styles are plain CSS in `styles.css` / `charts.css` with kebab-case class names. The frontend is light-theme only (dark mode was removed by design), and animations should respect `prefers-reduced-motion`.
- Keep user-facing strings plain-English and friendly; metric explanations should avoid jargon (see `metricDescriptions` in `main.jsx` for the established tone).

### Commits

Short imperative subjects with a conventional prefix, matching existing history:
`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Submitting a pull request

1. Fork the repo and create a branch: `feat/<short-name>` or `fix/<short-name>`.
2. Keep PRs small and focused — one feature or one fix per PR.
3. If you change the API (new params, response shapes, limits), **update the README** endpoint table and any affected frontend code in the same PR.
4. Make sure `pytest` and `cd frontend && npm run build` pass.
5. For UI changes, include before/after screenshots (and check the dark theme).
6. Open the PR against `main` with a short "what / why" description and link any related issues.

## Reporting bugs

Open a [GitHub issue](https://github.com/PIYUSH-NEXTGEN/LUMEN/issues) and include:

- What happened vs. what you expected
- Steps to reproduce (command, flags, or click path)
- OS, Python version, and Node version (if frontend-related)
- The full traceback or browser console output
- A sample image that triggers the problem, if relevant

## License

By contributing, you agree that your contributions are licensed under the same terms as the project's [LICENSE](LICENSE).
