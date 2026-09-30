# Orbit OS compatibility guide

This page describes the explicit `--hermes-home PATH` compatibility reader. The default Orbit OS workspace uses portable personal exports and public watchlists. For that workflow, start with the [README](../README.md) and [command reference](../skills/orbitdiff/references/commands.md).

## Architecture

Compatibility mode has three independent pieces:

1. Existing collectors produce durable local artifacts on their existing schedules.
2. A standard-library Python adapter reads those artifacts into a sanitized view model.
3. A browser interface requests that view model from a loopback-only Python server.

Compatibility mode never executes a collector. No provider request or outbound message occurs when the app starts, refreshes, or exports a view. Explicit Instagram profile links open an external site. The separate portable mode also offers a protected, user-requested public scan action.

Personal SQLite reads use a private temporary snapshot of the database and optional write-ahead log. Source file identities, sizes, and modification timestamps must remain stable across the copy. Changing sources retry a bounded number of times, then fail closed. SQLite opens only the copy, so it cannot create WAL helper files in the source directory. The temporary snapshot is removed after the read.

## Source contract

All paths below are relative to the configured Hermes home, normally `~/.hermes`.

| Lane | Source | Meaning |
| --- | --- | --- |
| Personal | `artifacts/instagram-personal-graph/<account>/graph.db` | Profile counts, confirmed following and followed-by edges, relationship events, and collection runs |
| Watched accounts | `artifacts/ig-following-watch/<account>/state.json` | Last observed following list, pending observations, and recorded confirmed changes |
| List visibility | `artifacts/ig-following-watch/<account>/list_visibility.json` | Explicit visible or hidden state, including accounts that have no baseline |
| Schedule health | `cron/jobs.json` | Allowlisted Instagram collector schedules and sanitized outcomes |

The legacy `artifacts/social-follow-graph/graph.db` roster is never used. Personal followers are not inferred from other-account state. A missing source is unavailable, not an empty list or a zero count.

### Personal relationships

Only edges with `confirmed=1` establish a relationship. A positive confirmed outgoing and incoming edge forms a mutual. A positive confirmed outgoing edge and an explicitly false confirmed incoming edge forms a nonreciprocal relationship. Missing or unconfirmed incoming evidence remains unknown.

The named follower set is bounded coverage, not a complete crawl. Profile totals and observed named relationships therefore have separate labels. A lost mutual relationship does not by itself prove an inbound unfollow. Unattributed count deltas carry no account identity.

Failed runs do not replace the last good profile counts. The app distinguishes attempt time from last successful data time. Records older than 36 hours are marked stale. Refreshing the app does not reset the collection timestamp.

### Watched accounts

The most recent following list is labeled observed. Only `confirmed_new` and `confirmed_unfollows` history fields produce confirmed events. `gone_raw` is never treated as an unfollow. Pending additions and removals remain separate from confirmed events.

A hidden list with no state has an unavailable count. It does not mean the account follows zero people. A successful visibility-check schedule does not imply a successful list collection.

## Local API

`GET /api/state` returns `schema_version`, `generated_at`, `personal`, `watchlist`, `schedules`, and `issues`. Each source has its own status and diagnostics, so one unreadable file does not erase healthy sources. The response is allowlisted; raw metadata, schedule prompts, delivery destinations, error text, and session material are not returned.

`GET /api/health` identifies the running app and version. It reports application availability, not collection success. All mutation methods are rejected.

The server binds only to `127.0.0.1`. Host and Origin checks resist browser-based cross-origin access and DNS rebinding. Responses are not cached. Static assets are an explicit allowlist; arbitrary files cannot be served. A restrictive content security policy blocks remote scripts and framing.

## Starting and stopping

From the checkout:

```bash
PYTHONPATH=src python3 -m orbit_os app --hermes-home PATH --open
```

Replace PATH with the selected compatibility source. The terminal owns this server and Ctrl+C stops it. The separate self-contained Mac app bundles its runtime and owns its window/server lifecycle. Neither route installs a launch agent or login item.

Manual refresh rereads the local sources. It never retries Instagram requests. For HTTP 429, wait for the collection cooldown and inspect the collector's own recovery process. Do not repeatedly refresh or rebaseline a blocked collector.

## Repository and rollback

The source history is preserved from OrbitDiff. No remote rename, push, or publication is necessary to run compatibility mode locally.

The import transaction changed only this checkout's Git state and app files. No source artifacts were moved, copied into the checkout, or modified. The rollback boundary is the Git commit titled `Checkpoint OrbitDiff before Orbit OS app`. To undo application changes, revert the later app commit after stopping the local server. The existing collectors and schedules continue independently.

Agent history, screenshots, and local verification receipts are excluded through `.remember/` and `.orbit-local/`. Neither directory belongs in distribution archives. The package audit checks both built distributions and private-data patterns.

## Verification

Run the repository checks:

```bash
python3 -m pytest -q
python3 -m ruff check .
python3 -m mypy src
python3 -m build
python3 scripts/package_audit.py dist/*.whl dist/*.tar.gz dist/orbitdiff-skill-*.zip
python3 scripts/public_safety_scan.py .
gh skill publish --dry-run .
```

Use synthetic source fixtures for adapter and server tests. Browser verification should cover navigation, relationship filtering, activity filtering, export, loading failure, missing data, keyboard access, and mobile overflow. Live artifact reads validate integration; they do not establish that Instagram collection is currently healthy.
