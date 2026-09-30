# Daily Following Alerts Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. The primary agent implements; helpers investigate and review read-only.

**Goal:** Durable opt-in daily public following collection with native notifications.

**Architecture:** Existing SQLite history gains job and outbox tables. A supported host invokes a deterministic one-shot CLI; a native adapter submits frozen notifications.

**Tech Stack:** Existing Python, sqlite3, zoneinfo, pytest, and macOS osascript. No added service or dependency.

**Spec:** `docs/superpowers/specs/2026-09-30-daily-following-alerts-design.md`

## Global constraints

The existing source evidence and 30-minute cooldown contracts remain. Preserve primary checkout, web surfaces, AGENTS.md and unrelated work. Public examples are synthetic. No live collection or notification activation without supplied inputs. Keep private receipts. Standing authorization replaces phase approval pauses.

## Review focus

- A suspended collector returns after a newer admission: reject stale results.
- A crash occurs between event commit and enqueue: reconcile once on restart.
- A native send returns no acknowledgement: hold uncertain rather than duplicate silently.
- A pause occurs during bounded work: prevent new claims and show in-flight work.
- Host time and product time disagree: runtime preserves due state; registration alone never proves scheduled operation.

## Task 1: Daily state and shared collection [Codex]

Files: new `src/orbitdiff/alert_schedule.py`, `src/orbitdiff/alert_store.py`, `src/orbitdiff/live.py`; modify store/CLI; tests `test_alert_schedule.py`, `test_alert_store.py`, `test_live.py`.

Interfaces: `daily_due(now, time, timezone)` and `next_due(...)` return UTC datetime. `AlertStore(GraphStore)` owns additive migration, configuration, lifecycle, and transactional window claims. `collect_live(store, target, provider_factory, now, baseline=False)` returns structured result and shares admission/fencing with existing CLI.

- [ ] Write focused behavior tests before each change; run with the selected existing Python and `-m pytest` to observe missing behavior.
- [ ] Implement migration, date policy, configure/bind/enable/pause/update/remove/status, durable claims, and fenced shared collection. Test real temporary SQLite databases and simultaneous callers.
- [ ] Run focused tests and existing store/CLI regressions. Expected: all pass, preserved source fingerprints and silent baseline.
- [ ] Commit the logical state/collection slice.

## Task 2: Outbox and native delivery [Codex]

Files: new `src/orbitdiff/alert_delivery.py`, outbox persistence in `alert_store.py`; tests `test_alert_delivery.py`.

Interfaces: stored subscriptions and event IDs feed `reconcile_notifications(job_id, now)`; `dispatch(job_id, sender, now)` returns persisted delivery outcomes. `MacOSSender.send(payload, key)` returns accepted/failed/uncertain. Sender protocol declares idempotency support.

- [ ] Write failing tests for reconciliation after commit, subscription isolation/cutoff, immutable chunks, refollows, claims, crashes, retry limits, unavailable platform, and data passed as argv.
- [ ] Implement unique event mappings, immutable delivery units, durable attempt receipts, lease fencing, bounded retry, local failure/recovery notices, and explicit uncertainty resolution.
- [ ] Run focused tests and state/collection regressions. Expected: notification failure causes no provider request; paused jobs produce no new deliveries.
- [ ] Commit the outbox/delivery slice.

## Task 3: One-shot commands and installed behavior [Codex]

Files: new `src/orbitdiff/alerts.py`, `src/orbit_os/alerts_cli.py`; modify `src/orbit_os/cli.py`, `workspace.py`; tests `test_alerts.py`, `test_alerts_cli.py`; extend candidate install smoke as needed.

Interfaces: `run_job(store, job_id, now, provider_factory, sender)` claims at most one due window, records outcomes, reconciles and dispatches. CLI actions expose that service; read-only status never writes. A retained absolute runtime reference is compared, never executed from database data.

- [ ] Write failing end-to-end offline tests covering three synthetic days, all lifecycle commands, missing/manual prerequisites, injected collection/delivery failures, runtime path rejection, and redacted JSON.
- [ ] Implement commands, no-side-effect dry-run, status projection, bounded job service, and the native synthetic delivery test command.
- [ ] Run focused and full pytest. Expected: deterministic receipts preserve distinct evidence gates and old workflows.
- [ ] Commit integration slice.

## Task 4: Skill, package, and review [Codex]

Files: `CONTEXT.md`, skill router/references, mirrored onboarding/prompt, README, release readiness/checklist, changelog, package/version inputs only where coherent. Keep host registration instructions in the scheduling reference.

- [ ] Read applicable writing/skill/prompt skills, document the actual commands and Codex native-tool registration workflow, and label unreleased capability independently from published installation pins.
- [ ] Run pytest, Ruff, mypy, build, skill build, package audit, dependency check, public scan, and skill validation. Install exact wheel/archive outside checkout and verify origins and new offline commands.
- [ ] Personally review the diff, obtain one fresh independent whole-branch review, and fix material findings with red/green tests.
- [ ] Commit, push focused branch, create and attach PR, check exact head CI, then use existing merge authorization only after checks pass and verify merged CI.

## Activation [User inputs, then Codex]

The async request asks only for missing activation inputs. If supplied, use the exact installed candidate for a bounded manual collection, native delivery verification and native host registration. Record the real job reference. Actual later timer invocations and three real daily windows remain separate gates. If inputs are absent, finish Task 4 and report activation Unproven without inventing targets or jobs.

## Failure mitigations

Collector suspension is fenced by persisted admission identity. Delivery ambiguity is durable and requires reconciliation or explicit retry. Host downtime creates recorded gaps and at most one catch-up attempt. Tests and real receipts remain distinct.
