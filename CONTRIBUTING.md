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

Keep v0.1 focused on confirmed changes in public following lists. Do not add private-profile access, account actions, password handling, browser data import, cloud sync, telemetry, a daemon, content collection, or identity enrichment.

## Pull requests

- Add a focused test before behavior changes and run it red before implementation.
- Keep storage limited to the documented public account and event fields.
- Preserve complete-collection and two-scan confirmation behavior.
- Run the full local verification set before opening a pull request.
- Use synthetic handles and data in tests, docs, and screenshots.

Read [AGENTS.md](AGENTS.md) for repository-specific agent instructions.
