"""Read-only projections of the two independent local Instagram trackers."""

from __future__ import annotations

import json
import os
import re
import sqlite3
import stat
import unicodedata
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

_USERNAME = re.compile(r"(?!\.+$)[A-Za-z0-9._]{1,30}")
_IDENTIFIER = re.compile(r"[A-Za-z0-9_-]{1,128}")
_CRON = re.compile(r"[0-9*/,-]+(?: [0-9*/,-]+){4}")
_STALE_AFTER = timedelta(hours=36)
_MAX_JSON_BYTES = 32 * 1024 * 1024
_MAX_DATABASE_BYTES = 128 * 1024 * 1024
_MAX_ROWS = 100_000
_FileVersion = tuple[int, int, int, int, int, int]
_EVENT_TYPES = {
    "follower_started", "follower_stopped", "following_started", "following_stopped",
    "became_mutual", "lost_mutual", "privacy_changed", "verification_changed",
    "username_changed", "unknown_inbound_delta",
}
_EVENT_SOURCES = {"activity", "reciprocal", "recent_followers", "following"}
_SCRIPT_LABELS = {
    "ig_personal_graph_watch.py": "Personal relationship graph",
    "ig_dashboard_build.py": "Legacy dashboard rebuild",
    "ig_following_watch.py": "Following watcher",
    "ig_following_watch_any.py": "Following watcher",
}
_ERROR_RECOVERY = {
    "rate_limited": "Wait for the next scheduled attempt before retrying the source tracker.",
    "dependency_missing": "Repair the existing tracker's Python environment before its next run.",
    "session_expired": "Check the existing tracker session locally before its next run.",
    "collection_incomplete": "Keep the last good snapshot until a complete collection succeeds.",
    "collection_error": "Inspect the existing tracker's local run log for the failed attempt.",
}


def _issue(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def _username(value: Any) -> str | None:
    return value if isinstance(value, str) and _USERNAME.fullmatch(value) else None


def _identifier(value: Any) -> str | None:
    if isinstance(value, int) and not isinstance(value, bool):
        value = str(value)
    return value if isinstance(value, str) and _IDENTIFIER.fullmatch(value) else None


def _count(value: Any) -> int | None:
    return value if type(value) is int and 0 <= value <= 10**12 else None


def _integer(value: Any) -> int | None:
    return value if type(value) is int and abs(value) <= 10**12 else None


def _boolean(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if type(value) is int and value in (0, 1):
        return bool(value)
    return None


def _timestamp(value: Any) -> str | None:
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(UTC).isoformat(timespec="seconds")
    except (ValueError, OverflowError):
        return None


def _is_stale(value: str | None, now: datetime) -> bool:
    return value is None or now - datetime.fromisoformat(value) > _STALE_AFTER


def _full_name(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    clean = "".join(
        " " if character.isspace() else character
        for character in value[:2000].replace(chr(8212), "-")
        if character.isspace() or not unicodedata.category(character).startswith("C")
    )
    return " ".join(clean.split())[:200]


def _source_path(home: Path, *parts: str) -> Path:
    """Reject symlinked sources instead of following them outside the source tree."""
    path = home
    for part in parts:
        path = path / part
        if path.is_symlink():
            raise OSError("linked source")
    return path


def _directories(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return sorted(
        (path for path in root.iterdir()
         if _username(path.name) and not path.is_symlink() and path.is_dir()),
        key=lambda path: path.name.lower(),
    )


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    if path.is_symlink() or path.stat().st_size > _MAX_JSON_BYTES:
        raise ValueError("invalid source")
    with path.open("rb") as stream:
        raw = stream.read(_MAX_JSON_BYTES + 1)
    if len(raw) > _MAX_JSON_BYTES:
        raise ValueError("oversized source")
    result: Any = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError("invalid document")
    return result


class _SourceChanged(OSError):
    """A source changed while a consistent snapshot was being copied."""


def _file_version(status: os.stat_result) -> _FileVersion:
    return (
        status.st_dev, status.st_ino, status.st_mode, status.st_size,
        status.st_mtime_ns, status.st_ctime_ns,
    )


def _source_version(path: Path, *, optional: bool = False) -> _FileVersion | None:
    try:
        status = path.lstat()
    except FileNotFoundError as error:
        if optional:
            return None
        raise _SourceChanged("source disappeared") from error
    if not stat.S_ISREG(status.st_mode):
        raise OSError("source is not a regular file")
    if status.st_size > _MAX_DATABASE_BYTES:
        raise ValueError("source exceeds snapshot limit")
    return _file_version(status)


def _snapshot_versions(home: Path, database: Path) -> dict[Path, _FileVersion | None]:
    if home.is_symlink():
        raise OSError("linked source root")
    _source_path(home, *database.relative_to(home).parts)
    # A rollback journal may hold the undo data for pages not yet committed.
    # Do not copy or recover it; wait for a later stable source instead.
    journal = database.with_name(database.name + "-journal")
    try:
        journal.lstat()
    except FileNotFoundError:
        pass
    else:
        raise _SourceChanged("rollback transaction may be active")
    wal = database.with_name(database.name + "-wal")
    return {database: _source_version(database), wal: _source_version(wal, optional=True)}


def _copy_source_file(source: Path, destination: Path, version: _FileVersion) -> None:
    """Copy one allowlisted source through a non-following, read-only descriptor."""
    if not hasattr(os, "O_NOFOLLOW"):
        raise OSError("non-following source reads are unavailable")
    flags = os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0)
    try:
        descriptor = os.open(source, flags)
    except FileNotFoundError as error:
        raise _SourceChanged("source disappeared") from error
    with os.fdopen(descriptor, "rb") as reader:
        if _file_version(os.fstat(reader.fileno())) != version:
            raise _SourceChanged("source identity changed")
        destination_descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(destination_descriptor, "wb") as writer:
            remaining = version[3]
            while remaining:
                chunk = reader.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise _SourceChanged("source was truncated")
                writer.write(chunk)
                remaining -= len(chunk)
            if reader.read(1) or _file_version(os.fstat(reader.fileno())) != version:
                raise _SourceChanged("source contents changed")


@contextmanager
def _snapshot_connection(home: Path, database: Path) -> Iterator[sqlite3.Connection]:
    """Open SQLite only on a private stable copy, including committed WAL frames."""
    for attempt in range(3):
        with TemporaryDirectory(prefix="orbit-os-graph-") as directory:
            private = Path(directory)
            private.chmod(0o700)
            try:
                before = _snapshot_versions(home, database)
                for source, version in before.items():
                    if version is not None:
                        _copy_source_file(source, private / source.name, version)
                if _snapshot_versions(home, database) != before:
                    raise _SourceChanged("source changed while copying")
            except _SourceChanged:
                if attempt == 2:
                    raise
                continue
            snapshot = private / database.name
            connection = sqlite3.connect(snapshot.as_uri() + "?mode=rw", uri=True, timeout=1)
            try:
                connection.row_factory = sqlite3.Row
                connection.execute("PRAGMA query_only = ON")
                connection.execute("BEGIN")
                yield connection
            finally:
                connection.close()
            return


def _empty_personal() -> dict[str, Any]:
    return {
        "username": None, "status": "missing", "stale": True,
        "last_success_at": None, "last_attempt_at": None,
        "metrics": dict.fromkeys((
            "followers", "following", "mutuals", "not_following_back", "followers_observed",
            "following_observed", "reciprocal_unknown", "unattributed_balance",
        )),
        "accounts": [], "events": [], "runs": [], "coverage": None, "issues": [],
    }


def _coverage(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    pattern = (
        r"following exact; inbound (?:coverage bounded|reciprocal shard priority \d{1,6}, "
        r"rotating \d{1,6}/\d{1,6})(?:; (?:activity|recent_followers|reciprocal) degraded)*"
    )
    return value if re.fullmatch(pattern, value) else None


def _error_kind(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    # Raw exception messages are used only to choose a fixed, safe label.
    lowered = value[:100_000].lower()
    if any(part in lowered for part in ("429", "rate limit", "too many requests")):
        return "rate_limited"
    if any(part in lowered for part in ("modulenotfounderror", "importerror", "no module named")):
        return "dependency_missing"
    if any(part in lowered for part in ("login expired", "session expired", "login required", "unauthorized", "401")):
        return "session_expired"
    if any(part in lowered for part in ("partialcollectionerror", "incomplete", "truncated")):
        return "collection_incomplete"
    return "collection_error"


def _relationship(following: bool | None, followed_by: bool | None) -> str:
    if following is True:
        if followed_by is True:
            return "mutual"
        if followed_by is False:
            return "not_following_back"
    if following is False:
        if followed_by is True:
            return "follows_you"
        if followed_by is False:
            return "inactive"
    return "unknown"


def _personal_accounts(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    edges: dict[str, dict[str, bool | None]] = {}
    for row in connection.execute(
        "SELECT account_pk, edge_name, value, confirmed FROM edges LIMIT ?", (_MAX_ROWS * 2,)
    ):
        account_id = _identifier(row["account_pk"])
        if account_id and row["edge_name"] in {"following", "followed_by"}:
            edges.setdefault(account_id, {})[row["edge_name"]] = (
                _boolean(row["value"]) if _boolean(row["confirmed"]) is True else None
            )
    accounts = []
    for row in connection.execute(
        "SELECT pk, username, full_name, is_private, is_verified, updated_at FROM accounts LIMIT ?",
        (_MAX_ROWS,),
    ):
        account_id = _identifier(row["pk"])
        if account_id is None:
            continue
        confirmed = edges.get(account_id, {})
        following, followed_by = confirmed.get("following"), confirmed.get("followed_by")
        accounts.append({
            "id": account_id, "username": _username(row["username"]),
            "full_name": _full_name(row["full_name"]),
            "is_private": _boolean(row["is_private"]), "is_verified": _boolean(row["is_verified"]),
            "following": following, "followed_by": followed_by,
            "relationship": _relationship(following, followed_by),
            "updated_at": _timestamp(row["updated_at"]),
        })
    return sorted(accounts, key=lambda row: (row["username"] or "", row["id"]))


def _personal_runs(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    runs = []
    for row in connection.execute(
        "SELECT id, status, started_at, finished_at, follower_count, following_count, coverage, "
        "error_kind FROM runs ORDER BY id DESC LIMIT 2000"
    ):
        ts = _timestamp(row["started_at"])
        run_id = _identifier(row["id"])
        if ts is None or run_id is None:
            continue
        status = row["status"] if row["status"] in {"ok", "degraded", "failed", "running"} else "failed"
        runs.append({
            "id": run_id, "ts": ts, "finished_at": _timestamp(row["finished_at"]), "status": status,
            "followers": _count(row["follower_count"]), "following": _count(row["following_count"]),
            "coverage": _coverage(row["coverage"]), "error_kind": _error_kind(row["error_kind"]),
        })
    return sorted(runs, key=lambda row: (row["ts"], row["id"]), reverse=True)


def _personal_events(
    connection: sqlite3.Connection, accounts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    account_map = {account["id"]: account for account in accounts}
    events = []
    for row in connection.execute(
        "SELECT id, event_type, account_pk, details_json, observed_at "
        "FROM events ORDER BY id DESC LIMIT 10000"
    ):
        event_type, ts = row["event_type"], _timestamp(row["observed_at"])
        event_id = _identifier(row["id"])
        if event_type not in _EVENT_TYPES or ts is None or event_id is None:
            continue
        details: dict[str, Any] = {}
        raw = row["details_json"]
        if isinstance(raw, str) and len(raw) <= 4096:
            try:
                decoded: Any = json.loads(raw)
                if isinstance(decoded, dict):
                    details = decoded
            except (ValueError, RecursionError):
                pass
        account = account_map.get(_identifier(row["account_pk"]) or "", {})
        delta = _integer(details.get("delta")) if event_type == "unknown_inbound_delta" else None
        if event_type == "unknown_inbound_delta":
            account = {}
            if delta is None:
                continue
        source = details.get("source")
        events.append({
            "id": event_id, "ts": ts, "type": event_type,
            "username": account.get("username"), "full_name": account.get("full_name"),
            "delta": delta, "source": source if isinstance(source, str) and source in _EVENT_SOURCES else None,
        })
    return sorted(events, key=lambda event: (event["ts"], event["id"]), reverse=True)


def _load_personal(home: Path, now: datetime) -> dict[str, Any]:
    result = _empty_personal()
    try:
        root = _source_path(home, "artifacts", "instagram-personal-graph")
        databases = [
            directory / "graph.db" for directory in _directories(root)
            if (directory / "graph.db").exists()
        ]
        if not databases:
            result["issues"].append(_issue("personal_missing", "No personal graph snapshot is available."))
            return result
        if len(databases) != 1:
            result["status"] = "error"
            result["issues"].append(_issue("personal_ambiguous", "Multiple personal graphs are present; no account was selected."))
            return result
        database = databases[0]
        if database.is_symlink():
            raise OSError("linked source")
        result["username"] = database.parent.name
        with _snapshot_connection(home, database) as connection:
            accounts = _personal_accounts(connection)
            runs = _personal_runs(connection)
            events = _personal_events(connection, accounts)
            balance_row = connection.execute(
                "SELECT value FROM meta WHERE key = 'unattributed_follower_balance'"
            ).fetchone()
            balance = None
            if balance_row and isinstance(balance_row[0], str) and re.fullmatch(r"-?\d{1,12}", balance_row[0]):
                balance = int(balance_row[0])
        latest = runs[0] if runs else None
        good = next((run for run in runs if run["status"] in {"ok", "degraded"}), None)
        result.update(accounts=accounts, events=events, runs=runs)
        result["last_attempt_at"] = latest["ts"] if latest else None
        result["last_success_at"] = (good["finished_at"] or good["ts"]) if good else None
        result["coverage"] = good["coverage"] if good else None
        result["stale"] = _is_stale(result["last_success_at"], now)
        if good:
            result["metrics"] = {
                "followers": good["followers"], "following": good["following"],
                "mutuals": sum(account["relationship"] == "mutual" for account in accounts),
                "not_following_back": sum(account["relationship"] == "not_following_back" for account in accounts),
                "followers_observed": sum(account["followed_by"] is True for account in accounts),
                "following_observed": sum(account["following"] is True for account in accounts),
                "reciprocal_unknown": sum(account["following"] is True and account["followed_by"] is None for account in accounts),
                "unattributed_balance": balance,
            }
        if latest and latest["status"] == "failed":
            result["status"] = "failed"
            kind = latest["error_kind"] or "collection_error"
            result["issues"].append(_issue(kind, _ERROR_RECOVERY[kind]))
        elif latest and latest["status"] == "running":
            result["status"] = "degraded"
            result["issues"].append(_issue("collection_running", "A source collection has not recorded completion."))
        elif not good:
            result["status"] = "degraded"
            result["issues"].append(_issue("personal_no_success", "No completed personal graph run is available."))
        elif result["stale"]:
            result["status"] = "stale"
        else:
            result["status"] = good["status"]
    except (OSError, ValueError, sqlite3.Error, RecursionError):
        result = _empty_personal()
        result["status"] = "error"
        result["issues"].append(_issue("personal_unreadable", "The personal graph could not be read safely."))
    return result


def _empty_watch(username: str) -> dict[str, Any]:
    return {
        "username": username, "status": "missing", "stale": True, "last_run_at": None,
        "visibility": "unknown", "last_visibility_at": None,
        "following_count": None, "pending_count": None, "pending_removals": None,
        "accounts": [], "events": [], "history": [], "issues": [],
    }


def _watch_history(history: Any, username: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    result: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    if not isinstance(history, list):
        return result, events
    seen_events: set[tuple[str, str, str]] = set()
    for row in history[-10000:]:
        if not isinstance(row, dict) or (ts := _timestamp(row.get("ts"))) is None:
            continue
        counts = {}
        for key, event_type in (("confirmed_new", "following_started"), ("confirmed_unfollows", "following_stopped")):
            values = row.get(key)
            handles = sorted({handle for value in values if (handle := _username(value))}) if isinstance(values, list) else []
            counts[key] = len(handles)
            for handle in handles:
                identity = (ts, event_type, handle)
                if identity in seen_events:
                    continue
                seen_events.add(identity)
                events.append({
                    "id": f"{username}:{ts}:{event_type}:{handle}", "ts": ts, "type": event_type,
                    "username": handle, "full_name": None, "delta": None, "source": "watcher_confirmed",
                })
        result.append({
            "ts": ts, "following_count": _count(row.get("following_count")),
            "confirmed_new_count": counts["confirmed_new"],
            "confirmed_removed_count": counts["confirmed_unfollows"],
            "pending_count": _count(row.get("pending_count")),
        })
    return sorted(result, key=lambda row: row["ts"], reverse=True), sorted(events, key=lambda row: row["ts"], reverse=True)


def _watch_accounts(state: dict[str, Any], ts: str | None) -> list[dict[str, Any]]:
    roster = state.get("last_pull")
    if not isinstance(roster, dict):
        return []
    pending = state.get("pending")
    pending_ids = set(pending) if isinstance(pending, dict) else set()
    accounts = []
    for account_id, item in roster.items():
        if not isinstance(item, dict) or (safe_id := _identifier(account_id)) is None:
            continue
        accounts.append({
            "id": safe_id, "username": _username(item.get("username")),
            "full_name": _full_name(item.get("full_name")),
            "is_private": _boolean(item.get("is_private")),
            "is_verified": _boolean(item.get("is_verified")),
            "status": "pending" if account_id in pending_ids else "observed", "updated_at": ts,
        })
    return sorted(accounts, key=lambda row: (row["username"] or "", row["id"]))


def _load_watch(directory: Path, now: datetime) -> dict[str, Any]:
    result = _empty_watch(directory.name)
    try:
        marker = _read_json(directory / "list_visibility.json")
        if marker:
            visibility = marker.get("following")
            if visibility in ("hidden", "visible"):
                result["visibility"] = visibility
            result["last_visibility_at"] = _timestamp(marker.get("checked_at"))
    except (OSError, ValueError, RecursionError):
        result["issues"].append(_issue("visibility_unreadable", "List visibility could not be read safely."))
    try:
        state = _read_json(directory / "state.json")
        if state is not None:
            if state.get("schema") != 2 or not isinstance(state.get("last_pull"), dict):
                raise ValueError("unsupported watcher state")
            result["last_run_at"] = _timestamp(state.get("last_run_utc"))
            result["stale"] = _is_stale(result["last_run_at"], now)
            result["accounts"] = _watch_accounts(state, result["last_run_at"])
            result["following_count"] = len(state["last_pull"])
            for source, dest in (("pending", "pending_count"), ("pending_gone", "pending_removals")):
                value = state.get(source)
                result[dest] = len(value) if isinstance(value, dict) else None
            result["history"], result["events"] = _watch_history(state.get("history"), directory.name)
            if result["last_run_at"] is None:
                result["status"] = "degraded"
                result["issues"].append(_issue("watcher_timestamp_invalid", "The last observation time is unavailable."))
            elif result["stale"]:
                result["status"] = "stale"
            else:
                result["status"] = "ok"
            if result["issues"] and result["status"] == "ok":
                result["status"] = "degraded"
        elif result["visibility"] != "hidden":
            result["issues"].append(_issue("watcher_missing", "No watched-account observation is available."))
    except (OSError, ValueError, RecursionError):
        result["status"] = "error"
        result["issues"].append(_issue("watcher_unreadable", "This watched-account observation could not be read safely."))
    if result["visibility"] == "hidden":
        result["status"] = "hidden"
        result["issues"].append(_issue("list_hidden", "The following list is hidden. Any saved roster is an earlier observation."))
    return result


def _load_schedules(home: Path, watchlist: list[dict[str, Any]]) -> list[dict[str, Any]]:
    payload = _read_json(_source_path(home, "cron", "jobs.json"))
    if payload is None:
        return []
    jobs = payload.get("jobs")
    if not isinstance(jobs, list):
        raise ValueError("invalid schedule document")
    labels = dict(_SCRIPT_LABELS)
    labels.update({f"ig_following_watch_{watch['username']}.py": "Following watcher" for watch in watchlist})
    result = []
    for job in jobs:
        if not isinstance(job, dict) or not isinstance(job.get("script"), str):
            continue
        script = Path(job["script"]).name
        if script not in labels or (job_id := _identifier(job.get("id"))) is None:
            continue
        schedule = job.get("schedule")
        expression = schedule.get("expr") if isinstance(schedule, dict) and schedule.get("kind") == "cron" else None
        last_status = job.get("last_status")
        error_kind = _error_kind(job.get("last_error")) if last_status in ("error", "failed") else None
        if last_status in ("error", "failed") and error_kind is None:
            error_kind = "collection_error"
        result.append({
            "id": job_id, "name": labels[script], "script": script,
            "enabled": _boolean(job.get("enabled")),
            "schedule": expression if isinstance(expression, str) and _CRON.fullmatch(expression) else None,
            "last_run_at": _timestamp(job.get("last_run_at")),
            "next_run_at": _timestamp(job.get("next_run_at")),
            "last_status": last_status if last_status in ("ok", "error", "failed", "running", "skipped") else None,
            "error_kind": error_kind, "recovery": _ERROR_RECOVERY.get(error_kind or ""),
        })
    return result


def _attach_personal_schedule(personal: dict[str, Any], schedules: list[dict[str, Any]]) -> None:
    jobs = [job for job in schedules if job["script"] == "ig_personal_graph_watch.py" and job["last_run_at"]]
    if not jobs:
        return
    latest = max(jobs, key=lambda job: job["last_run_at"])
    if latest["last_run_at"] < (personal["last_attempt_at"] or ""):
        return
    personal["last_attempt_at"] = latest["last_run_at"]
    if latest["last_status"] in ("error", "failed"):
        if personal["status"] not in ("error", "missing"):
            personal["status"] = "failed"
        kind = latest["error_kind"] or "collection_error"
        personal["issues"] = [
            issue for issue in personal["issues"] if issue["code"] not in _ERROR_RECOVERY
        ]
        personal["issues"].append(_issue(kind, _ERROR_RECOVERY[kind]))


def load_state(hermes_home: Path | None = None) -> dict[str, Any]:
    """Project existing source files without importing, collecting, or changing them."""
    home = hermes_home if hermes_home is not None else Path.home() / ".hermes"
    now = datetime.now(UTC)
    result: dict[str, Any] = {
        "schema_version": 1, "generated_at": now.isoformat(timespec="seconds"),
        "personal": _load_personal(home, now), "watchlist": [], "schedules": [], "issues": [],
    }
    try:
        root = _source_path(home, "artifacts", "ig-following-watch")
        result["watchlist"] = [_load_watch(directory, now) for directory in _directories(root)]
    except (OSError, ValueError):
        result["issues"].append(_issue("watchlist_unreadable", "Watched-account sources could not be listed safely."))
    try:
        result["schedules"] = _load_schedules(home, result["watchlist"])
    except (OSError, ValueError, RecursionError):
        result["issues"].append(_issue("schedules_unreadable", "Existing tracker schedules could not be read safely."))
    _attach_personal_schedule(result["personal"], result["schedules"])
    return result
