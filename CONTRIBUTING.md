# Contributing to LUMEN


## Setup

```bash
python -m venv .venv
source .venv/bin/activate      # .venv\Scripts\activate on Windows
pip install -e .
```

```bash
cd frontend
npm install
```

Postgres is optional. Only needed for `--save-db` and the `/images`, `/compare`, `/duplicates` endpoints. Setup steps are in the [README](README.md#setup).

## Running it

| What | Command |
|---|---|
| CLI | `python main.py --folder images --output image_results.csv --json-output image_results.json` |
| API | `uvicorn api:app --reload` (docs at `/docs` unless `ENV=production`) |
| Frontend | `cd frontend && npm run dev` |

Frontend hits `localhost:8000` by default — change with `VITE_API_BASE_URL`. If you're testing anything behind auth, set matching `API_KEY` and `VITE_API_KEY` locally.

## Where things go

- Analysis math goes in `image_analyzer/` — small, pure, vectorized functions. Not in `api.py`, not in `main.jsx`.
- `analyzer.py` / `main.py` / `api.py` just wire those functions together.
- The whole dashboard is one file, `frontend/src/main.jsx`, on purpose. Don't split it into components as a side quest — open an issue first if you think it should change.

## Code style

**Python**
- Type hints on public functions. Docstrings short, no filler.
- 4-space indents, double quotes, f-strings.
- New dependencies need an issue first — keeping this list small on purpose.
- Run `ruff check .` before opening a PR if you have it installed.

**React**
- Function components and hooks only. `ErrorBoundary` is the one class component, because React requires it.
- No new UI libraries.
- Kebab-case CSS classes. Light theme only — don't bring back dark mode without discussing it first.
- Plain-English copy, no jargon. Match the tone in `metricDescriptions`.
- If you change how a feature works, update the tour step, How It Works, and Limitations copy in the same PR — don't let them drift.

**Commits**
`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:` — imperative, one change per commit.

## Tests

```bash
pytest -v
cd frontend && npm run build
```

Bug fixes need a regression test. No test, no merge.

## Pull requests

- One feature or fix per PR — keep it small.
- API changes (new params, response shape, limits) update the README and any affected frontend code in the same PR.
- Tests and `npm run build` pass before you open it.
- UI changes need before/after screenshots and a check at mobile width.
- Branch names: `feat/<name>` or `fix/<name>`. Link the related issue if there is one.

## Reporting bugs

Open an issue with: what happened vs. what you expected, exact repro steps, your OS/Python/Node version, the full error (not a summary), and a sample image if it's image-specific. "It doesn't work" gets sent back for details.

## Security issues

Don't open a public issue. This project already had one full security audit and fix round, so treat any new finding the same way — use GitHub's private vulnerability reporting (Security tab → Report a vulnerability) instead of posting it where anyone can see it before it's fixed.

## License

Contributions are covered by the same [LICENSE](LICENSE) as the rest of the project.
