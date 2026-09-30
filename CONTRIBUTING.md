# Contributing

Thanks for improving OrbitDiff.

## Local setup

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[dev]'
python -m pytest -q
ruff check .
mypy src
```

## Scope

Keep owner-supplied personal relationship exports separate from confirmed changes in other accounts' public following lists. Both workflows use local storage and read-only Instagram access. Do not add private-profile collection, account actions, password handling, browser data import, cloud sync, telemetry, a daemon, content collection, or identity enrichment.

## Pull requests

- Add a focused test before behavior changes and run it red before implementation.
- Keep storage limited to the documented personal snapshot, public account, and event fields. Personal exports remain local.
- Preserve complete-collection and two-scan confirmation behavior.
- Run the full local verification set before opening a pull request.
- Use synthetic handles and data in tests, docs, and screenshots.

Read [AGENTS.md](AGENTS.md) for repository-specific agent instructions.
