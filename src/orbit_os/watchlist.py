"""Read-only OrbitDiff projection for a portable Orbit OS workspace."""

from __future__ import annotations

import re
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .data import (
    _count,
    _empty_watch,
    _identifier,
    _is_stale,
    _issue,
    _snapshot_connection,
    _timestamp,
    _username,
)

_MAX_ROWS = 100_000


def _rows(
    connection: sqlite3.Connection, query: str, parameters: tuple[str, ...] = (),
) -> list[sqlite3.Row]:
    result = connection.execute(query, parameters).fetchmany(_MAX_ROWS + 1)
    if len(result) > _MAX_ROWS:
        raise ValueError("watchlist exceeds the projection limit")
    return result


def _time(value: Any, *, sqlite_utc: bool = False) -> str | None:
    if sqlite_utc and isinstance(value, str) and re.fullmatch(
        r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", value,
    ):
        try:
            return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC).isoformat()
        except ValueError:
            return None
    return _timestamp(value)


def _project_watch(
    connection: sqlite3.Connection, target: str, now: datetime, attempts_available: bool,
) -> dict[str, Any]:
    result = _empty_watch(target)
    result["source"] = "orbitdiff"
    result["last_attempt_at"] = None
    runs = _rows(
        connection,
        "SELECT id, state, collected_at, collected_count FROM runs WHERE target = ? ORDER BY id DESC",
        (target,),
    )
    successful = [row for row in runs if row["state"] == "success"]
    latest = runs[0] if runs else None
    if latest is not None:
        result["last_attempt_at"] = _time(latest["collected_at"], sqlite_utc=latest["state"] == "failed")
    if successful:
        good = successful[0]
        result["last_run_at"] = _time(good["collected_at"])
        result["stale"] = _is_stale(result["last_run_at"], now)
        result["following_count"] = _count(good["collected_count"])
        result["visibility"] = "visible"
        result["last_visibility_at"] = result["last_run_at"]
        result["status"] = "stale" if result["stale"] else "ok"
        if result["last_run_at"] is None or result["following_count"] is None:
            result["status"] = "degraded"
            result["issues"].append(_issue(
                "watcher_observation_invalid", "The saved observation's time or size is unavailable.",
            ))

    edge_rows = _rows(
        connection,
        """SELECT e.actor_id, e.confirmed_present, e.pending_present, a.username
        FROM edges AS e JOIN accounts AS a ON a.profile_id = e.actor_id
        WHERE e.target = ? ORDER BY a.username, e.actor_id""", (target,),
    )
    if successful:
        result["pending_count"] = sum(row["pending_present"] == 1 for row in edge_rows)
        result["pending_removals"] = sum(row["pending_present"] == 0 for row in edge_rows)
    for row in edge_rows:
        observed = row["confirmed_present"] if row["pending_present"] is None else row["pending_present"]
        if observed != 1:
            continue
        account_id, username = _identifier(row["actor_id"]), _username(row["username"])
        if account_id is None or username is None:
            result["issues"].append(_issue("account_invalid", "A saved account could not be displayed safely."))
            continue
        result["accounts"].append({
            "id": account_id, "username": username, "full_name": "",
            "is_private": None, "is_verified": None,
            "status": "pending" if row["pending_present"] == 1 else "observed",
            "updated_at": result["last_run_at"],
        })

    event_rows = _rows(
        connection,
        """SELECT id, actor_id, username, event_type, confirmed_at, first_seen_at, run_id
        FROM events WHERE target = ? ORDER BY id DESC""", (target,),
    )
    event_counts: dict[int, dict[str, int]] = {}
    for row in event_rows:
        timestamp = _time(row["confirmed_at"])
        username = _username(row["username"])
        event_type = row["event_type"]
        if timestamp is None or username is None or event_type not in ("following_started", "following_stopped"):
            continue
        counts = event_counts.setdefault(row["run_id"], {"following_started": 0, "following_stopped": 0})
        counts[event_type] += 1
        result["events"].append({
            "id": f"{target}:{row['id']}", "ts": timestamp, "type": event_type,
            "username": username, "full_name": None, "delta": None,
            "source": "watcher_confirmed", "first_seen_at": _time(row["first_seen_at"]),
        })
    for row in successful:
        timestamp = _time(row["collected_at"])
        if timestamp is None:
            continue
        counts = event_counts.get(row["id"], {})
        result["history"].append({
            "ts": timestamp, "following_count": _count(row["collected_count"]),
            "confirmed_new_count": counts.get("following_started", 0),
            "confirmed_removed_count": counts.get("following_stopped", 0),
            # Historical pending totals are not recorded by older OrbitDiff stores.
            "pending_count": result["pending_count"] if row is successful[0] else None,
        })

    if latest is not None and latest["state"] == "failed":
        result["status"] = "failed"
        result["issues"].append(_issue(
            "watchlist_collection_failed",
            "The last live attempt failed. Saved observations are unchanged. Wait at least 30 minutes before an explicit retry.",
        ))
    if attempts_available:
        attempt = connection.execute(
            "SELECT attempted_at FROM live_attempts WHERE target = ?", (target,),
        ).fetchone()
        if attempt is not None and (attempt_at := _time(attempt["attempted_at"])) is not None:
            if result["last_attempt_at"] is None or attempt_at > result["last_attempt_at"]:
                result["last_attempt_at"] = attempt_at
                if result["status"] in ("ok", "stale"):
                    result["status"] = "degraded"
                result["issues"].append(_issue(
                    "watchlist_attempt_unfinished", "A live attempt has no recorded result. The last saved observation is shown.",
                ))
    if result["issues"] and result["status"] == "ok":
        result["status"] = "degraded"
    return result


def load_watchlist(database: Path) -> list[dict[str, Any]]:
    """Read a stable source copy; missing is empty, unreadable sources raise.

    Do not route this through GraphStore's initializing status/events methods.
    SQLite is opened only on the private copy, preserving original sidecars.
    """
    if not database.exists() and not database.is_symlink():
        return []
    with _snapshot_connection(database.parent, database) as connection:
        attempts_available = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'live_attempts'"
        ).fetchone() is not None
        query = "SELECT target FROM targets UNION SELECT target FROM runs"
        if attempts_available:
            query += " UNION SELECT target FROM live_attempts"
        targets = _rows(connection, query + " ORDER BY target")
        now = datetime.now(UTC)
        result = []
        for row in targets:
            target = _username(row["target"])
            if target is None:
                raise ValueError("stored target is invalid")
            result.append(_project_watch(connection, target, now, attempts_available))
        return result
