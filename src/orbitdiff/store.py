from __future__ import annotations

import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .diff import EdgeState, reconcile
from .models import Account, Collection, Event

_SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_meta (
    version INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS targets (
    target TEXT PRIMARY KEY,
    initialized_at TEXT NOT NULL
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


class GraphStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if os.name != "nt":
            self.path.parent.chmod(0o700)
        with self._connection() as connection:
            connection.executescript(_SCHEMA)
            connection.execute("INSERT OR IGNORE INTO schema_meta(version) VALUES (1)")
        if os.name != "nt" and self.path.exists():
            self.path.chmod(0o600)

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        try:
            yield connection
        finally:
            connection.close()

    def apply_collection(self, collection: Collection, *, baseline_run: bool = False) -> list[Event]:
        if not collection.complete:
            raise ValueError("incomplete collections cannot change graph state")
        self.initialize()
        collected_at = collection.collected_at.isoformat()
        unique_accounts = {account.profile_id: account for account in collection.accounts}
        if any(not profile_id for profile_id in unique_accounts):
            raise ValueError("accounts require a stable public profile ID")

        with self._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                target_row = connection.execute(
                    "SELECT target FROM targets WHERE target = ?", (collection.target,)
                ).fetchone()
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

    def record_failed_run(self, target: str, error: str) -> None:
        self.initialize()
        with self._connection() as connection:
            connection.execute(
                """INSERT INTO runs(target, state, run_kind, collected_at, error)
                VALUES (?, 'failed', 'scan', datetime('now'), ?)""",
                (target, error),
            )
            connection.commit()

    def status(self, target: str) -> dict[str, int | str]:
        self.initialize()
        with self._connection() as connection:
            confirmed_count = connection.execute(
                "SELECT COUNT(*) FROM edges WHERE target = ? AND confirmed_present = 1", (target,)
            ).fetchone()[0]
            pending_count = connection.execute(
                "SELECT COUNT(*) FROM edges WHERE target = ? AND pending_present IS NOT NULL", (target,)
            ).fetchone()[0]
            failed_runs = connection.execute(
                "SELECT COUNT(*) FROM runs WHERE target = ? AND state = 'failed'", (target,)
            ).fetchone()[0]
        return {
            "target": target,
            "confirmed_count": int(confirmed_count),
            "pending_count": int(pending_count),
            "failed_runs": int(failed_runs),
        }

    def last_live_scan_at(self, target: str) -> str | None:
        self.initialize()
        with self._connection() as connection:
            row = connection.execute(
                """SELECT collected_at FROM runs WHERE target = ? AND state = 'success' AND run_kind = 'scan'
                ORDER BY id DESC LIMIT 1""",
                (target,),
            ).fetchone()
        return None if row is None else str(row["collected_at"])

    def events(self, target: str) -> list[Event]:
        self.initialize()
        with self._connection() as connection:
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
