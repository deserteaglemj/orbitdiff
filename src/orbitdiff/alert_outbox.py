"""Recoverable delivery units derived from persisted confirmed event IDs."""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timedelta
from typing import Any

from .alert_schedule import aware
from .alert_store import AlertStore, _has_alerts
from .providers.base import InvalidTargetError, normalize_target

_SCHEMA = """
CREATE TABLE IF NOT EXISTS alert_subscriptions (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES alert_jobs(id),
 channel TEXT NOT NULL, destination TEXT NOT NULL, active INTEGER NOT NULL,
 after_event INTEGER NOT NULL, created_at TEXT NOT NULL, warning TEXT,
 recovery_pending INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS alert_subscription_active ON alert_subscriptions(job_id) WHERE active=1;
CREATE TABLE IF NOT EXISTS alert_notices (
 id TEXT PRIMARY KEY, sub_id TEXT NOT NULL REFERENCES alert_subscriptions(id),
 key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, kind TEXT NOT NULL,
 created_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt TEXT NOT NULL,
 lease_token TEXT, lease_until TEXT, idempotent INTEGER NOT NULL DEFAULT 0,
 detail TEXT
);
CREATE TABLE IF NOT EXISTS alert_notice_events (
 sub_id TEXT NOT NULL REFERENCES alert_subscriptions(id), event_id INTEGER NOT NULL REFERENCES events(id),
 notice_id TEXT NOT NULL REFERENCES alert_notices(id), PRIMARY KEY(sub_id,event_id)
);
CREATE TABLE IF NOT EXISTS alert_delivery_attempts (
 token TEXT PRIMARY KEY, notice_id TEXT NOT NULL REFERENCES alert_notices(id),
 started_at TEXT NOT NULL, finished_at TEXT, state TEXT NOT NULL, detail TEXT
);
"""


def _date(value: str) -> str:
    try:
        return aware(datetime.fromisoformat(value)).isoformat(timespec="minutes")
    except ValueError:
        return "unknown observation time"


def _line(row: sqlite3.Row) -> str:
    try:
        handle = normalize_target(str(row["username"]))
        label = f"{handle} https://www.instagram.com/{handle}/"
    except InvalidTargetError:
        label = "handle unavailable"
    return f"{label}\nFirst observed {_date(row['first_seen_at'])}; confirmed {_date(row['confirmed_at'])}.\n"


class OutboxStore(AlertStore):
    def initialize(self) -> None:
        super().initialize()
        with self._connection() as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                for statement in _SCHEMA.split(";"):
                    if statement.strip():
                        conn.execute(statement)
                conn.execute("INSERT OR IGNORE INTO schema_meta VALUES (3)")

    def _on_enable(self, conn: sqlite3.Connection, job: dict[str, Any], now: datetime) -> None:
        if conn.execute("SELECT 1 FROM alert_subscriptions WHERE job_id=? AND active=1", (job["id"],)).fetchone():
            return
        cutoff = conn.execute("SELECT COALESCE(MAX(id),0) FROM events").fetchone()[0]
        conn.execute("""INSERT INTO alert_subscriptions
            (id,job_id,channel,destination,active,after_event,created_at)
            VALUES (?,?,'macos','current-user',1,?,?)""",
            (uuid.uuid4().hex, job["id"], cutoff, now.isoformat()))

    @staticmethod
    def _insert_notice(conn: sqlite3.Connection, sub_id: str, payload: str,
                       kind: str, now: datetime, *, identity: str | None = None) -> str:
        notice_id = uuid.uuid4().hex
        database_id = conn.execute("SELECT uuid FROM alert_identity WHERE id=1").fetchone()[0]
        key = f"{database_id}:{sub_id}:{identity or notice_id}"
        conn.execute("""INSERT OR IGNORE INTO alert_notices
            (id,sub_id,key,payload,kind,created_at,next_attempt) VALUES (?,?,?,?,?,?,?)""",
            (notice_id, sub_id, key, payload, kind, now.isoformat(), now.isoformat()))
        return notice_id

    def reconcile_notifications(self, job_id: str, *, now: datetime) -> int:
        current = aware(now)
        with self._connection() as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                job = self._job(conn, job_id)
                if job["state"] not in {"enabled", "blocked"}:
                    return 0
                total = 0
                for sub in conn.execute("SELECT * FROM alert_subscriptions WHERE job_id=? AND active=1", (job_id,)).fetchall():
                    rows = conn.execute("""SELECT e.* FROM events e WHERE e.target=? AND e.id>?
                        AND e.event_type='following_started' AND NOT EXISTS
                        (SELECT 1 FROM alert_notice_events ne WHERE ne.sub_id=? AND ne.event_id=e.id)
                        ORDER BY e.id LIMIT 10000""", (job["target"], sub["after_event"], sub["id"])).fetchall()
                    header = f"OrbitDiff: confirmed additions for {job['target']}.\nObservation times, not exact follow times.\n"
                    payload = header
                    members: list[int] = []
                    for row in rows:
                        line = _line(row)
                        if members and len((payload+line).encode()) > 2000:
                            self._enqueue_events(conn, sub["id"], payload, members, current)
                            payload, members = header, []
                        payload += line
                        members.append(int(row["id"]))
                    if members:
                        self._enqueue_events(conn, sub["id"], payload, members, current)
                    total += len(rows)
                return total

    def _enqueue_events(self, conn: sqlite3.Connection, sub_id: str, payload: str,
                        members: list[int], now: datetime) -> None:
        notice_id = self._insert_notice(conn, sub_id, payload, "following_started", now)
        conn.executemany("INSERT INTO alert_notice_events VALUES (?,?,?)", [(sub_id,e,notice_id) for e in members])

    def status_notice(self, job_id: str, *, identity: str, payload: str, now: datetime) -> None:
        with self._connection() as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                for row in conn.execute("SELECT id FROM alert_subscriptions WHERE job_id=? AND active=1", (job_id,)).fetchall():
                    self._insert_notice(conn, row[0], payload, "status", aware(now), identity=identity)

    def notices(self, job_id: str) -> list[dict[str, Any]]:
        with self._read_connection() as conn:
            if conn is None or not _has_alerts(conn) or not conn.execute(
                "SELECT 1 FROM sqlite_master WHERE name='alert_notices'"
            ).fetchone():
                return []
            return [dict(row) for row in conn.execute("""SELECT n.*,
                (SELECT COUNT(*) FROM alert_notice_events e WHERE e.notice_id=n.id) AS event_count
                FROM alert_notices n JOIN alert_subscriptions s ON n.sub_id=s.id WHERE s.job_id=?
                ORDER BY n.rowid""", (job_id,))]

    def delivery_attempts(self, job_id: str) -> list[dict[str, Any]]:
        with self._read_connection() as conn:
            if conn is None:
                return []
            return [dict(row) for row in conn.execute("""SELECT a.* FROM alert_delivery_attempts a
                JOIN alert_notices n ON n.id=a.notice_id JOIN alert_subscriptions s ON n.sub_id=s.id
                WHERE s.job_id=? ORDER BY a.started_at,a.rowid""", (job_id,))]

    def jobs(self, *, now: datetime | None = None) -> list[dict[str, Any]]:
        jobs = super().jobs(now=now)
        with self._read_connection() as conn:
            if conn is None or not conn.execute("SELECT 1 FROM sqlite_master WHERE name='alert_subscriptions'").fetchone():
                return jobs
            for job in jobs:
                row = conn.execute("SELECT warning FROM alert_subscriptions WHERE job_id=? AND active=1", (job["id"],)).fetchone()
                job["delivery_warning"] = row[0] if row else None
                job["delivery_counts"] = {r[0]: r[1] for r in conn.execute("""SELECT n.state,COUNT(*)
                    FROM alert_notices n JOIN alert_subscriptions s ON n.sub_id=s.id
                    WHERE s.job_id=? GROUP BY n.state""", (job["id"],))}
        return jobs

    def claim_notice(self, job_id: str, *, now: datetime, idempotent: bool) -> dict[str, Any] | None:
        current = aware(now)
        with self._connection() as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                if self._job(conn, job_id)["state"] not in {"enabled", "blocked"}:
                    return None
                expired = conn.execute("""SELECT n.* FROM alert_notices n JOIN alert_subscriptions s ON n.sub_id=s.id
                    WHERE s.job_id=? AND n.state='sending' AND n.lease_until<=?""", (job_id,current.isoformat())).fetchall()
                for row in expired:
                    state = "failed" if row["idempotent"] and idempotent else "uncertain"
                    conn.execute("UPDATE alert_notices SET state=?,detail='submission_uncertain' WHERE id=?", (state,row["id"]))
                    conn.execute("UPDATE alert_delivery_attempts SET state='uncertain',detail='lease_expired',finished_at=? WHERE token=?",
                                 (current.isoformat(),row["lease_token"]))
                    conn.execute("UPDATE alert_subscriptions SET warning='submission_uncertain',recovery_pending=1 WHERE id=?", (row["sub_id"],))
                row = conn.execute("""SELECT n.* FROM alert_notices n JOIN alert_subscriptions s ON n.sub_id=s.id
                    WHERE s.job_id=? AND s.active=1 AND n.state IN ('pending','failed')
                    AND n.attempts<3 AND n.next_attempt<=? ORDER BY n.rowid LIMIT 1""", (job_id,current.isoformat())).fetchone()
                if row is None:
                    return None
                token = uuid.uuid4().hex
                conn.execute("""UPDATE alert_notices SET state='sending',attempts=attempts+1,lease_token=?,lease_until=?,idempotent=?
                    WHERE id=?""", (token,(current+timedelta(minutes=2)).isoformat(),int(idempotent),row["id"]))
                conn.execute("INSERT INTO alert_delivery_attempts(token,notice_id,started_at,state) VALUES (?,?,?,'sending')",
                             (token,row["id"],current.isoformat()))
                return dict(conn.execute("SELECT * FROM alert_notices WHERE id=?", (row["id"],)).fetchone())

    def finish_notice(self, notice_id: str, token: str, *, state: str, detail: str, now: datetime) -> bool:
        if state not in {"accepted", "failed", "uncertain"}:
            raise ValueError("invalid submission result")
        current = aware(now)
        with self._connection() as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute("SELECT * FROM alert_notices WHERE id=? AND lease_token=? AND state='sending'", (notice_id,token)).fetchone()
                if row is None:
                    return False
                conn.execute("UPDATE alert_notices SET state=?,detail=?,next_attempt=? WHERE id=?",
                             (state,detail,(current+timedelta(minutes=30)).isoformat(),notice_id))
                conn.execute("UPDATE alert_delivery_attempts SET state=?,detail=?,finished_at=? WHERE token=?",
                             (state,detail,current.isoformat(),token))
                sub = conn.execute("SELECT * FROM alert_subscriptions WHERE id=?", (row["sub_id"],)).fetchone()
                if state != "accepted":
                    conn.execute("UPDATE alert_subscriptions SET warning=?,recovery_pending=1 WHERE id=?", (detail,row["sub_id"]))
                elif sub["recovery_pending"]:
                    conn.execute("UPDATE alert_subscriptions SET warning=NULL,recovery_pending=0 WHERE id=?", (row["sub_id"],))
                    if row["kind"] != "delivery_recovery":
                        self._insert_notice(conn, row["sub_id"],
                            "OrbitDiff notification submission is working again. Previously uncertain notices remain in status for review.",
                            "delivery_recovery", current)
                return True

    def resolve(self, notice_id: str, *, action: str, now: datetime) -> None:
        if action not in {"retry", "discard"}:
            raise ValueError("choose retry or discard")
        with self._read_connection() as conn:
            if conn is None or not conn.execute("SELECT 1 FROM sqlite_master WHERE name='alert_notices'").fetchone():
                raise ValueError("only uncertain or failed notices can be resolved")
        with self._connection() as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute("SELECT state FROM alert_notices WHERE id=?", (notice_id,)).fetchone()
                if row is None or row[0] not in {"uncertain", "failed"}:
                    raise ValueError("only uncertain or failed notices can be resolved")
                conn.execute("UPDATE alert_notices SET state=?,attempts=0,next_attempt=?,detail='user_resolved' WHERE id=?",
                             ("pending" if action=="retry" else "discarded",aware(now).isoformat(),notice_id))
