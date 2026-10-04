"""Durable opt-in jobs in the existing relationship database."""
from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .alert_schedule import aware, daily_due, next_due, schedule_parts
from .paths import validate_local_path
from .providers.base import normalize_target
from .store import GraphStore

_SCHEMA = """
CREATE TABLE IF NOT EXISTS alert_identity (id INTEGER PRIMARY KEY CHECK(id=1), uuid TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS alert_jobs (
 id TEXT PRIMARY KEY, target TEXT NOT NULL, workspace TEXT NOT NULL,
 runtime TEXT NOT NULL, login TEXT NOT NULL, session_file TEXT,
 time TEXT NOT NULL, timezone TEXT NOT NULL, host TEXT NOT NULL DEFAULT 'codex',
 host_job_id TEXT, state TEXT NOT NULL DEFAULT 'paused', created_at TEXT NOT NULL,
 activated_at TEXT, last_due TEXT, last_day TEXT, blocked_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS alert_target ON alert_jobs(target) WHERE state != 'removed';
CREATE TABLE IF NOT EXISTS alert_windows (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES alert_jobs(id),
 due_at TEXT NOT NULL, claimed_at TEXT NOT NULL, finished_at TEXT, state TEXT NOT NULL,
 missed_windows INTEGER NOT NULL, missed_from TEXT, reason TEXT,
 UNIQUE(job_id,due_at)
);
"""


def _has_alerts(connection: sqlite3.Connection | None) -> bool:
    return connection is not None and connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='alert_jobs'"
    ).fetchone() is not None


class AlertStore(GraphStore):
    def initialize(self) -> None:
        super().initialize()
        with self._connection() as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                for statement in _SCHEMA.split(";"):
                    if statement.strip():
                        conn.execute(statement)
                conn.execute("INSERT OR IGNORE INTO alert_identity VALUES (1, ?)", (uuid.uuid4().hex,))
                conn.execute("INSERT OR IGNORE INTO schema_meta VALUES (2)")

    @staticmethod
    def _job(conn: sqlite3.Connection, job_id: str) -> dict[str, Any]:
        row = conn.execute("SELECT * FROM alert_jobs WHERE id=?", (job_id,)).fetchone()
        if row is None:
            raise ValueError("alert job was not found")
        return dict(row)

    def job(self, job_id: str) -> dict[str, Any]:
        """Internal execution configuration; callers must not print login references."""
        with self._read_connection() as conn:
            if not _has_alerts(conn) or conn is None:
                raise ValueError("alert job was not found")
            return self._job(conn, job_id)

    def jobs(self, *, now: datetime | None = None) -> list[dict[str, Any]]:
        current = aware(now or datetime.now(UTC))
        with self._read_connection() as conn:
            if not _has_alerts(conn) or conn is None:
                return []
            result = []
            for row in conn.execute("SELECT * FROM alert_jobs ORDER BY created_at,id"):
                job = dict(row)
                job.pop("login")
                job.pop("session_file")
                state = self._target_status(conn, job["target"])
                job.update(last_attempt_at=state["last_attempt_at"],
                           last_complete_at=state["last_success_at"], pending_count=state["pending_count"])
                job["next_due_at"], job["due_now"] = None, False
                if job["state"] == "enabled":
                    due = daily_due(current, job["time"], job["timezone"])
                    boundary = max(datetime.fromisoformat(job["activated_at"]),
                                   datetime.fromisoformat(job["last_due"] or job["activated_at"]))
                    due_day = due.astimezone(ZoneInfo(job["timezone"])).date().isoformat()
                    job["due_now"] = due > boundary and (not job["last_day"] or due_day > job["last_day"])
                    following = due if job["due_now"] else next_due(max(current, boundary), job["time"], job["timezone"])
                    if job["last_day"] and following.astimezone(ZoneInfo(job["timezone"])).date().isoformat() <= job["last_day"]:
                        following = next_due(following, job["time"], job["timezone"])
                    job["next_due_at"] = following.isoformat()
                job["runs"] = [dict(r) for r in conn.execute(
                    "SELECT * FROM alert_windows WHERE job_id=? ORDER BY due_at DESC LIMIT 30", (job["id"],)
                )]
                result.append(job)
            return result

    def configure(self, target: str, *, login: str, runtime: Path, time: str,
                  timezone: str, now: datetime, session_file: Path | None = None) -> dict[str, Any]:
        target, login = normalize_target(target), normalize_target(login)
        current = aware(now)
        schedule_parts(time, timezone)
        if not runtime.is_absolute() or not runtime.is_file() or not os.access(runtime, os.X_OK):
            raise ValueError("runtime must be an existing absolute executable")
        if session_file is not None:
            session_file = validate_local_path(session_file)
        workspace = str(validate_local_path(self.path.parent))
        self.initialize()
        with self._connection() as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute("SELECT * FROM alert_jobs WHERE target=? AND state!='removed'", (target,)).fetchone()
                config = dict(runtime=str(runtime), login=login, session_file=str(session_file) if session_file else None,
                              time=time, timezone=timezone, workspace=workspace)
                if row is not None:
                    if any(row[key] != value for key, value in config.items()):
                        raise ValueError("existing job differs; pause and update its configuration")
                    job_id = str(row["id"])
                else:
                    job_id = uuid.uuid4().hex
                    conn.execute("""INSERT INTO alert_jobs
                        (id,target,workspace,runtime,login,session_file,time,timezone,created_at)
                        VALUES (?,?,?,?,?,?,?,?,?)""",
                        (job_id, target, workspace, str(runtime), login, config["session_file"], time, timezone, current.isoformat()))
        return next(job for job in self.jobs(now=current) if job["id"] == job_id)

    def bind(self, job_id: str, host_job_id: str) -> None:
        if not host_job_id or len(host_job_id) > 200 or any(ord(c) < 32 for c in host_job_id):
            raise ValueError("a valid host job ID is required")
        with self._connection() as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                job = self._job(conn, job_id)
                if job["state"] != "paused":
                    raise ValueError("host binding requires a paused job")
                conn.execute("UPDATE alert_jobs SET host_job_id=? WHERE id=?", (host_job_id, job_id))

    def enable(self, job_id: str, *, now: datetime) -> None:
        current = aware(now)
        with self._connection() as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                job = self._job(conn, job_id)
                if job["state"] == "removed":
                    raise ValueError("removed job cannot be enabled")
                if not job["host_job_id"]:
                    raise ValueError("bind the supported host schedule first")
                if not self._target_status(conn, job["target"])["initialized"]:
                    raise ValueError("a complete manual observation is required")
                if job["state"] == "enabled":
                    return
                self._on_enable(conn, job, current)
                conn.execute("UPDATE alert_jobs SET state='enabled',activated_at=?,blocked_reason=NULL WHERE id=?",
                             (current.isoformat(), job_id))

    def _on_enable(self, conn: sqlite3.Connection, job: dict[str, Any], now: datetime) -> None:
        """Extension point for atomic subscription activation."""

    def pause(self, job_id: str) -> None:
        self._set_state(job_id, "paused")

    def remove(self, job_id: str) -> None:
        self._set_state(job_id, "removed")

    def _set_state(self, job_id: str, state: str) -> None:
        with self._connection() as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                job = self._job(conn, job_id)
                if job["state"] == "removed" and state != "removed":
                    raise ValueError("removed job cannot be changed")
                conn.execute("UPDATE alert_jobs SET state=? WHERE id=?", (state, job_id))

    def update(self, job_id: str, *, time: str, timezone: str, now: datetime,
               runtime: Path | None = None, login: str | None = None,
               session_file: Path | None = None) -> None:
        schedule_parts(time, timezone)
        current = aware(now)
        if runtime is not None:
            validate_local_path(runtime)
            if not runtime.is_absolute() or not runtime.is_file() or not os.access(runtime, os.X_OK):
                raise ValueError("runtime must be an existing absolute executable")
        if login is not None:
            login = normalize_target(login)
        if session_file is not None:
            session_file = validate_local_path(session_file)
        with self._connection() as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                job = self._job(conn, job_id)
                if job["state"] != "paused":
                    raise ValueError("configuration changes require a paused job")
                conn.execute("""UPDATE alert_jobs SET time=?,timezone=?,host_job_id=NULL,activated_at=?,
                    runtime=?,login=?,session_file=? WHERE id=?""",
                    (time, timezone, current.isoformat(),str(runtime) if runtime else job["runtime"],
                     login or job["login"], str(session_file) if session_file else job["session_file"], job_id))

    def claim_window(self, job_id: str, *, now: datetime) -> dict[str, Any] | None:
        current = aware(now)
        with self._connection() as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                job = self._job(conn, job_id)
                if job["state"] != "enabled":
                    return None
                conn.execute("""UPDATE alert_windows SET state='interrupted',reason='worker_interrupted',finished_at=?
                              WHERE job_id=? AND state='running' AND claimed_at<?""",
                             (current.isoformat(), job_id, (current-timedelta(minutes=30)).isoformat()))
                due = daily_due(current, job["time"], job["timezone"])
                activation = datetime.fromisoformat(job["activated_at"])
                zone = ZoneInfo(job["timezone"])
                day = due.astimezone(zone).date().isoformat()
                if due <= activation or (job["last_due"] and due <= datetime.fromisoformat(job["last_due"])):
                    return None
                if job["last_day"] and day <= job["last_day"]:
                    return None
                first = next_due(max(activation, datetime.fromisoformat(job["last_due"]) if job["last_due"] else activation),
                                 job["time"], job["timezone"])
                missed = max(0, (due.astimezone(zone).date() - first.astimezone(zone).date()).days)
                window_id = uuid.uuid4().hex
                conn.execute("""INSERT INTO alert_windows
                    (id,job_id,due_at,claimed_at,state,missed_windows,missed_from)
                    VALUES (?,?,?,?,'running',?,?)""",
                    (window_id, job_id, due.isoformat(), current.isoformat(), missed,
                     first.isoformat() if missed else None))
                conn.execute("UPDATE alert_jobs SET last_due=?,last_day=? WHERE id=?", (due.isoformat(), day, job_id))
                return dict(conn.execute("SELECT * FROM alert_windows WHERE id=?", (window_id,)).fetchone())

    def finish_window(self, window_id: str, *, state: str, reason: str | None,
                      now: datetime, block: bool = False) -> None:
        with self._connection() as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                self._finish_window(conn, window_id, state=state, reason=reason, now=now, block=block)

    def _finish_window(self, conn: sqlite3.Connection, window_id: str, *, state: str,
                       reason: str | None, now: datetime, block: bool) -> None:
        row = conn.execute("SELECT * FROM alert_windows WHERE id=?", (window_id,)).fetchone()
        if row is None:
            return
        if row["state"] == "interrupted" and block:
            # The outer orchestration may replay a completion after explicit resume.
            # Persist handling once, and fence it against newer manual admissions too.
            if row["reason"] != "worker_interrupted":
                return
            target = self._job(conn, row["job_id"])["target"]
            admission = conn.execute("SELECT attempted_at FROM live_attempts WHERE target=?", (target,)).fetchone()
            if admission is None or admission[0] != row["claimed_at"]:
                return
            conn.execute("UPDATE alert_windows SET reason=? WHERE id=?", (reason, window_id))
            changed = conn.execute("UPDATE alert_jobs SET state='blocked',blocked_reason=? WHERE id=? AND state='enabled'",
                                   (reason, row["job_id"]))
            if changed.rowcount:
                self._on_window_finished(conn, dict(row), "failed", aware(now))
            return
        if row["state"] != "running":
            return
        conn.execute("UPDATE alert_windows SET state=?,reason=?,finished_at=? WHERE id=?",
                     (state, reason, aware(now).isoformat(), window_id))
        if block:
            conn.execute("UPDATE alert_jobs SET state='blocked',blocked_reason=? WHERE id=? AND state='enabled'",
                         (reason, row["job_id"]))
        self._on_window_finished(conn, dict(row), state, aware(now))

    def _on_live_result(self, connection: sqlite3.Connection, target: str,
                        attempted_at: datetime | None, state: str, reason: str | None,
                        now: datetime) -> None:
        if attempted_at is None:
            return
        # A window and its reserved attempt share an exact UTC admission instant.
        # Manual calls use GraphStore; skipped reservations never reach this hook.
        row = connection.execute("""SELECT w.id FROM alert_windows w JOIN alert_jobs j ON j.id=w.job_id
            WHERE j.target=? AND w.claimed_at=? AND w.state IN ('running','interrupted')""",
            (target, aware(attempted_at).isoformat())).fetchone()
        if row is not None:
            self._finish_window(connection, row[0], state=state, reason=reason, now=now, block=state == "failed")

    def _on_window_finished(self, conn: sqlite3.Connection, window: dict[str, Any],
                            state: str, now: datetime) -> None:
        """Extension point for notices committed with a terminal run state."""
