"""One-shot daily orchestration. The agent host supplies wakeups."""
from __future__ import annotations

import time
from collections.abc import Callable
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from .alert_delivery import Sender, dispatch
from .alert_outbox import OutboxStore
from .live import collect_live
from .providers.base import FollowingProvider


def deliver_job(store: OutboxStore, job_id: str, *, now: datetime, sender: Sender) -> dict[str, Any]:
    if str(store.path.parent.absolute()) != store.job(job_id)["workspace"]:
        return {"outcome": "blocked", "reason": "workspace_mismatch", "job_id": job_id,
                "events_enqueued": 0, "deliveries": [], "display_verified": False, "read_verified": False}
    queued = store.reconcile_notifications(job_id, now=now)
    deliveries = dispatch(store, job_id, sender, now=now)
    return {"outcome": ("partial" if any(r["state"] != "accepted" for r in deliveries) else
                         "success" if deliveries else "no_work"),
            "job_id": job_id, "events_enqueued": queued, "deliveries": deliveries,
            "display_verified": False, "read_verified": False}


def run_job(store: OutboxStore, job_id: str, *, now: datetime,
            provider_factory: Callable[[], FollowingProvider], sender: Sender,
            runtime: Path | None = None) -> dict[str, Any]:
    started = time.monotonic()
    job = store.job(job_id)
    if runtime is not None and str(runtime.absolute()) != job["runtime"]:
        return {"outcome": "blocked", "reason": "runtime_mismatch", "job_id": job_id,
                "collection": None, "deliveries": []}
    if str(store.path.parent.absolute()) != job["workspace"]:
        return {"outcome": "blocked", "reason": "workspace_mismatch", "job_id": job_id,
                "collection": None, "deliveries": []}
    window = store.claim_window(job_id, now=now)
    collection = None
    if window is not None:
        result = collect_live(store, job["target"], provider_factory, now=now)
        finished = now + timedelta(seconds=time.monotonic()-started)
        collection = {"state": result.state, "reason": result.reason, "window_id": window["id"],
                      "due_at": window["due_at"], "missed_windows": window["missed_windows"]}
        store.finish_window(window["id"], state=result.state, reason=result.reason, now=finished,
                            block=result.state == "failed")
    delivery = deliver_job(store, job_id, now=now + timedelta(seconds=time.monotonic()-started), sender=sender)
    delivery["collection"] = collection
    if collection:
        if collection["state"] != "success":
            delivery["outcome"] = "partial"
        elif delivery["outcome"] == "no_work":
            delivery["outcome"] = "success"
    elif job["state"] == "blocked":
        delivery["outcome"] = "blocked"
        delivery["reason"] = job["blocked_reason"]
    return delivery
