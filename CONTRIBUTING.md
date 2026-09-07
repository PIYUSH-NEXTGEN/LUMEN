# Contributing to LUMEN

Thanks for checking out LUMEN.

LUMEN is still a learning and portfolio project, so the codebase is intentionally small and straightforward. If you want to fix something, add a feature, improve the UI, or clean up the docs, contributions are welcome.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
# Windows:
# .venv\Scripts\activate

pip install -e .
```

For the frontend:

```bash
cd frontend
npm install
```

PostgreSQL is optional. You only need it for `--save-db` and the database-backed API endpoints. See the [README](https://github.com/PIYUSH-NEXTGEN/LUMEN/blob/main/README.md#setup) for the database setup.

## Running LUMEN

| Part     | Command                                                                                      |
| -------- | -------------------------------------------------------------------------------------------- |
| CLI      | `python main.py --folder images --output image_results.csv --json-output image_results.json` |
| API      | `uvicorn api:app --reload`                                                                   |
| Frontend | `cd frontend && npm run dev`                                                                 |

API docs are available at `/docs` unless `ENV=production`.

The frontend uses `localhost:8000` by default. Change it with `VITE_API_BASE_URL`.

If you're testing authenticated routes locally, set the same value for `API_KEY` and `VITE_API_KEY`.

## Where things go

* Image analysis code belongs in `image_analyzer/`.
* Keep analysis functions small and focused.
* `analyzer.py`, `main.py`, and `api.py` should mainly connect the pieces.
* The dashboard currently lives in `frontend/src/main.jsx`. Don't split it into a component system unless there's a good reason. Open an issue first if you think the structure needs to change.

## Code style

### Python

* Use type hints on public functions.
* Keep docstrings short.
* Use 4 spaces, double quotes, and f-strings.
* Avoid adding dependencies unless they're actually needed. Open an issue first for new ones.
* Run `ruff check .` before opening a PR if you have Ruff installed.

### React

* Function components and hooks.
* `ErrorBoundary` is the only class component.
* Don't add a new UI library without discussing it first.
* Use kebab-case CSS classes.
* Keep the existing light theme.
* Keep UI copy simple and consistent with the existing metric descriptions.
* If a feature changes, update the related tour, How It Works, and Limitations text too.

### Commits

Use prefixes like:

```text
feat:
fix:
docs:
refactor:
test:
chore:
```

Keep commits focused and use imperative wording.

## Tests

Run the backend tests:

```bash
pytest -v
```

Build the frontend:

```bash
cd frontend
npm run build
```

Bug fixes should include a regression test where possible.

## Pull requests

* Keep one feature or fix per PR.
* Update the README when changing the API or a user-facing feature.
* Make sure tests and the frontend build pass.
* For UI changes, include before/after screenshots and check the mobile layout.
* Use `feat/<name>` or `fix/<name>` for branches.
* Link an issue when there is one.

Small, focused PRs are easier to review.

## Reporting bugs

Open an issue with:

* What happened
* What you expected
* Steps to reproduce it
* OS, Python, and Node versions
* The full error message
* A sample image if the problem is image-specific

The more detail you include, the easier it is to reproduce.

## Security issues

Please don't post security issues publicly.

Use GitHub's private vulnerability reporting instead:

**Repository → Security → Report a vulnerability**

## License

LUMEN is licensed under the [LICENSE](https://github.com/PIYUSH-NEXTGEN/LUMEN/blob/main/LICENSE).


