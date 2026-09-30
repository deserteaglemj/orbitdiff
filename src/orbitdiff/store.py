from __future__ import annotations

import os
import re
import sqlite3
import stat
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from orbit_os.data import _snapshot_connection

from .diff import EdgeState, reconcile
from .models import Account, Collection, Event
from .paths import ensure_private_directory, validate_database_path
from .providers.base import validate_collection


class StaleAttemptError(RuntimeError):
    """A newer live admission owns the target's results."""

_SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_meta (
    version INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS targets (
    target TEXT PRIMARY KEY,
    initialized_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS live_attempts (
    target TEXT PRIMARY KEY,
    attempted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
    profile_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('success', 'failed')),
    run_kind TEXT NOT NULL CHECK(run_kind IN ('baseline', 'scan')),
    collected_at TEXT NOT NULL,
    reported_count INTEGER,
    collected_count INTEGER,
    error TEXT
);
CREATE TABLE IF NOT EXISTS edges (
    target TEXT NOT NULL REFERENCES targets(target),
    actor_id TEXT NOT NULL REFERENCES accounts(profile_id),
    confirmed_present INTEGER NOT NULL CHECK(confirmed_present IN (0, 1)),
    pending_present INTEGER CHECK(pending_present IN (0, 1)),
    pending_first_seen_at TEXT,
    pending_run_id INTEGER REFERENCES runs(id),
    PRIMARY KEY(target, actor_id)
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT NOT NULL REFERENCES targets(target),
    actor_id TEXT NOT NULL REFERENCES accounts(profile_id),
    username TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN ('following_started', 'following_stopped')),
    first_seen_at TEXT NOT NULL,
    confirmed_at TEXT NOT NULL,
    run_id INTEGER NOT NULL REFERENCES runs(id)
);
"""


def _attempt_time(value: str) -> datetime | None:
    """Legacy failed runs use SQLite's UTC datetime('now') representation."""
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", value):
            return None
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


class GraphStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def initialize(self) -> None:
        with self._connection() as connection:
            connection.executescript(_SCHEMA)
            connection.execute("INSERT OR IGNORE INTO schema_meta(version) VALUES (1)")
            connection.commit()

    def _prepare_database(self) -> Path:
        path = validate_database_path(self.path)
        ensure_private_directory(path.parent)
        validate_database_path(path)
        flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        try:
            descriptor = os.open(path, flags | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            descriptor = os.open(path, flags)
        try:
            status = os.fstat(descriptor)
            if not stat.S_ISREG(status.st_mode) or status.st_nlink != 1:
                raise OSError("database must be a regular file without links")
            if os.name != "nt":
                os.fchmod(descriptor, 0o600)
        finally:
            os.close(descriptor)
        return validate_database_path(path)

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        path = self._prepare_database()
        connection = sqlite3.connect(path.as_uri() + "?mode=rw", uri=True)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        try:
            yield connection
        finally:
            connection.close()

    @contextmanager
    def _read_connection(self) -> Iterator[sqlite3.Connection | None]:
        path = validate_database_path(self.path)
        if not path.exists():
            yield None
            return
        with _snapshot_connection(path.parent, path) as connection:
            yield connection

    def reserve_live_attempt(
        self, target: str, *, now: datetime | None = None,
        cooldown: timedelta = timedelta(minutes=30),
    ) -> bool:
        """Commit a cooldown reservation before any live provider can be called.

        The reservation survives failed or interrupted collectors. Existing
        baseline and failed-run history also counts when upgrading old stores.
        """
        current = now or datetime.now(UTC)
        if current.tzinfo is None or cooldown < timedelta(0):
            raise ValueError("an aware attempt time and nonnegative cooldown are required")
        current = current.astimezone(UTC)
        self.initialize()
        with self._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                timestamps = self._attempt_timestamps(connection, target)
                for value in timestamps:
                    previous = _attempt_time(value)
                    # Unknown dates must not accidentally permit a rapid retry.
                    if previous is None or current - previous < cooldown:
                        connection.rollback()
                        return False
                connection.execute(
                    """INSERT INTO live_attempts(target, attempted_at) VALUES (?, ?)
                    ON CONFLICT(target) DO UPDATE SET attempted_at = excluded.attempted_at""",
                    (target, current.isoformat()),
                )
                connection.commit()
                return True
            except BaseException:
                connection.rollback()
                raise

    @staticmethod
    def _attempt_timestamps(connection: sqlite3.Connection, target: str) -> list[str]:
        rows = connection.execute(
            """SELECT collected_at AS attempted_at FROM runs WHERE target = ?
            ORDER BY julianday(collected_at) DESC, id DESC LIMIT 1""",
            (target,),
        ).fetchall()
        if connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'live_attempts'"
        ).fetchone():
            rows += connection.execute(
                "SELECT attempted_at FROM live_attempts WHERE target = ?", (target,),
            ).fetchall()
        return [str(row["attempted_at"]) for row in rows]

    def targets(self) -> list[dict[str, Any]]:
        """Discover stored targets without creating or migrating the source."""
        with self._read_connection() as connection:
            if connection is None:
                return []
            query = "SELECT target FROM targets UNION SELECT target FROM runs"
            if connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'live_attempts'"
            ).fetchone():
                query += " UNION SELECT target FROM live_attempts"
            rows = connection.execute(query + " ORDER BY target").fetchall()
            return [self._target_status(connection, str(row["target"])) for row in rows]

    def roster(self, target: str) -> list[dict[str, Any]]:
        """Read both confirmation and latest observation for every known edge."""
        with self._read_connection() as connection:
            if connection is None:
                return []
            rows = connection.execute(
                """SELECT e.actor_id, a.username, e.confirmed_present,
                e.pending_present, e.pending_first_seen_at FROM edges AS e
                JOIN accounts AS a ON a.profile_id = e.actor_id
                WHERE e.target = ? ORDER BY a.username, e.actor_id""", (target,),
            ).fetchall()
        return [{
            "profile_id": str(row["actor_id"]), "username": str(row["username"]),
            "confirmed_present": bool(row["confirmed_present"]),
            "observed_present": bool(row["confirmed_present"] if row["pending_present"] is None else row["pending_present"]),
            "pending_present": None if row["pending_present"] is None else bool(row["pending_present"]),
            "pending_first_seen_at": row["pending_first_seen_at"],
        } for row in rows]

    def apply_collection(self, collection: Collection, *, baseline_run: bool = False,
                         attempted_at: datetime | None = None) -> list[Event]:
        if not collection.complete:
            raise ValueError("incomplete collections cannot change graph state")
        validate_collection(collection)
        self.initialize()
        collected_at = collection.collected_at.isoformat()
        unique_accounts = {account.profile_id: account for account in collection.accounts}
        if any(not profile_id for profile_id in unique_accounts):
            raise ValueError("accounts require a stable public profile ID")

        with self._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                self._check_attempt(connection, collection.target, attempted_at)
                target_row = connection.execute(
                    "SELECT target FROM targets WHERE target = ?", (collection.target,)
                ).fetchone()
                if baseline_run and target_row is not None:
                    connection.rollback()
                    return []
                cursor = connection.execute(
                    """INSERT INTO runs(target, state, run_kind, collected_at, reported_count, collected_count)
                    VALUES (?, 'success', ?, ?, ?, ?)""",
                    (
                        collection.target,
                        "baseline" if baseline_run else "scan",
                        collected_at,
                        collection.reported_count,
                        len(unique_accounts),
                    ),
                )
                if cursor.lastrowid is None:
                    raise RuntimeError("database did not return a run ID")
                run_id = int(cursor.lastrowid)
                if target_row is None:
                    connection.execute(
                        "INSERT INTO targets(target, initialized_at) VALUES (?, ?)",
                        (collection.target, collected_at),
                    )
                    for account in unique_accounts.values():
                        self._upsert_account(connection, account, collected_at)
                        connection.execute(
                            """INSERT INTO edges(target, actor_id, confirmed_present)
                            VALUES (?, ?, 1)""",
                            (collection.target, account.profile_id),
                        )
                    connection.commit()
                    return []

                for account in unique_accounts.values():
                    self._upsert_account(connection, account, collected_at)
                known_rows = connection.execute(
                    "SELECT actor_id FROM edges WHERE target = ?", (collection.target,)
                ).fetchall()
                known_ids = {str(row["actor_id"]) for row in known_rows}
                events: list[Event] = []
                for actor_id in sorted(known_ids | set(unique_accounts)):
                    event = self._apply_observation(
                        connection,
                        collection.target,
                        actor_id,
                        actor_id in unique_accounts,
                        run_id,
                        collected_at,
                    )
                    if event is not None:
                        events.append(event)
                connection.commit()
                return events
            except BaseException:
                connection.rollback()
                raise

    def _upsert_account(
        self, connection: sqlite3.Connection, account: Account, collected_at: str
    ) -> None:
        connection.execute(
            """INSERT INTO accounts(profile_id, username, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(profile_id) DO UPDATE SET username = excluded.username, updated_at = excluded.updated_at""",
            (account.profile_id, account.username, collected_at),
        )

    def _apply_observation(
        self,
        connection: sqlite3.Connection,
        target: str,
        actor_id: str,
        observed_present: bool,
        run_id: int,
        collected_at: str,
    ) -> Event | None:
        row = connection.execute(
            """SELECT confirmed_present, pending_present, pending_first_seen_at
            FROM edges WHERE target = ? AND actor_id = ?""",
            (target, actor_id),
        ).fetchone()
        if row is None:
            connection.execute(
                """INSERT INTO edges(target, actor_id, confirmed_present, pending_present,
                pending_first_seen_at, pending_run_id) VALUES (?, ?, 0, ?, ?, ?)""",
                (target, actor_id, int(observed_present), collected_at, run_id),
            )
            return None

        state = EdgeState(
            confirmed_present=bool(row["confirmed_present"]),
            pending_present=None if row["pending_present"] is None else bool(row["pending_present"]),
        )
        decision = reconcile(state, observed_present)
        if decision.kind == "none":
            return None
        if decision.kind == "pending":
            connection.execute(
                """UPDATE edges SET pending_present = ?, pending_first_seen_at = ?, pending_run_id = ?
                WHERE target = ? AND actor_id = ?""",
                (int(observed_present), collected_at, run_id, target, actor_id),
            )
            return None
        if decision.kind == "clear":
            connection.execute(
                """UPDATE edges SET pending_present = NULL, pending_first_seen_at = NULL,
                pending_run_id = NULL WHERE target = ? AND actor_id = ?""",
                (target, actor_id),
            )
            return None

        account = connection.execute(
            "SELECT username FROM accounts WHERE profile_id = ?", (actor_id,)
        ).fetchone()
        username = str(account["username"])
        first_seen_at = str(row["pending_first_seen_at"])
        event_type = str(decision.event_type)
        connection.execute(
            """UPDATE edges SET confirmed_present = ?, pending_present = NULL,
            pending_first_seen_at = NULL, pending_run_id = NULL WHERE target = ? AND actor_id = ?""",
            (int(observed_present), target, actor_id),
        )
        connection.execute(
            """INSERT INTO events(target, actor_id, username, event_type, first_seen_at, confirmed_at, run_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (target, actor_id, username, event_type, first_seen_at, collected_at, run_id),
        )
        return Event(
            event_type=event_type,  # type: ignore[arg-type]
            target=target,
            actor_id=actor_id,
            username=username,
            first_seen_at=first_seen_at,
            confirmed_at=collected_at,
            run_id=run_id,
        )

    @staticmethod
    def _check_attempt(connection: sqlite3.Connection, target: str,
                       attempted_at: datetime | None) -> None:
        if attempted_at is None:
            return
        row = connection.execute("SELECT attempted_at FROM live_attempts WHERE target=?", (target,)).fetchone()
        if row is None or row[0] != attempted_at.astimezone(UTC).isoformat():
            raise StaleAttemptError("a newer live attempt owns this target")

    def record_failed_run(self, target: str, error: str, *, baseline_run: bool = False,
                          attempted_at: datetime | None = None, now: datetime | None = None) -> None:
        self.initialize()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._check_attempt(connection, target, attempted_at)
            connection.execute(
                """INSERT INTO runs(target, state, run_kind, collected_at, error)
                VALUES (?, 'failed', ?, ?, ?)""",
                (target, "baseline" if baseline_run else "scan", (now or datetime.now(UTC)).isoformat(), error),
            )
            connection.commit()

    @staticmethod
    def _target_status(connection: sqlite3.Connection | None, target: str) -> dict[str, Any]:
        result: dict[str, Any] = {
            "target": target, "initialized": False, "observation_status": "missing",
            "confirmed_count": None, "pending_count": None, "failed_runs": 0,
            "initialized_at": None, "last_success_at": None, "last_attempt_at": None,
        }
        if connection is None:
            return result
        target_row = connection.execute(
            "SELECT initialized_at FROM targets WHERE target = ?", (target,),
        ).fetchone()
        latest = connection.execute(
            "SELECT state, collected_at FROM runs WHERE target = ? ORDER BY id DESC LIMIT 1",
            (target,),
        ).fetchone()
        good = connection.execute(
            "SELECT collected_at FROM runs WHERE target = ? AND state = 'success' ORDER BY id DESC LIMIT 1",
            (target,),
        ).fetchone()
        initialized = target_row is not None and good is not None
        result["initialized"] = initialized
        if initialized:
            confirmed_count = connection.execute(
                "SELECT COUNT(*) FROM edges WHERE target = ? AND confirmed_present = 1", (target,)
            ).fetchone()[0]
            pending_count = connection.execute(
                "SELECT COUNT(*) FROM edges WHERE target = ? AND pending_present IS NOT NULL", (target,)
            ).fetchone()[0]
            result.update(
                confirmed_count=int(confirmed_count), pending_count=int(pending_count),
                initialized_at=str(target_row["initialized_at"]),
                last_success_at=str(good["collected_at"]), observation_status="observed",
            )
        result["failed_runs"] = int(connection.execute(
            "SELECT COUNT(*) FROM runs WHERE target = ? AND state = 'failed'", (target,),
        ).fetchone()[0])
        if latest is not None and latest["state"] == "failed":
            result["observation_status"] = "failed"
        attempts = [
            value for timestamp in GraphStore._attempt_timestamps(connection, target)
            if (value := _attempt_time(timestamp)) is not None
        ]
        if attempts:
            last_attempt = max(attempts)
            result["last_attempt_at"] = last_attempt.isoformat()
            latest_time = _attempt_time(str(latest["collected_at"])) if latest is not None else None
            if latest_time is None or last_attempt > latest_time:
                result["observation_status"] = "pending"
        return result

    def status(self, target: str) -> dict[str, Any]:
        """Read stored status, keeping never-observed relationship counts unknown."""
        with self._read_connection() as connection:
            return self._target_status(connection, target)

    def last_live_scan_at(self, target: str) -> str | None:
        with self._read_connection() as connection:
            if connection is None:
                return None
            row = connection.execute(
                """SELECT collected_at FROM runs WHERE target = ? AND state = 'success' AND run_kind = 'scan'
                ORDER BY id DESC LIMIT 1""",
                (target,),
            ).fetchone()
        return None if row is None else str(row["collected_at"])

    def events(self, target: str) -> list[Event]:
        with self._read_connection() as connection:
            if connection is None:
                return []
            rows = connection.execute(
                """SELECT event_type, target, actor_id, username, first_seen_at, confirmed_at, run_id
                FROM events WHERE target = ? ORDER BY id""",
                (target,),
            ).fetchall()
        return [
            Event(
                event_type=str(row["event_type"]),  # type: ignore[arg-type]
                target=str(row["target"]),
                actor_id=str(row["actor_id"]),
                username=str(row["username"]),
                first_seen_at=str(row["first_seen_at"]),
                confirmed_at=str(row["confirmed_at"]),
                run_id=int(row["run_id"]),
            )
            for row in rows
        ]
