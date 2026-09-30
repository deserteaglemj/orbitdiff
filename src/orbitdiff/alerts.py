"""One-shot daily orchestration. The agent host supplies wakeups."""
from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from .alert_delivery import Sender, dispatch
from .alert_outbox import OutboxStore
from .live import collect_live
from .providers.base import FollowingProvider


def deliver_job(store: OutboxStore, job_id: str, *, now: datetime, sender: Sender) -> dict[str, Any]:
    queued = store.reconcile_notifications(job_id, now=now)
    deliveries = dispatch(store, job_id, sender, now=now)
    return {"outcome": ("partial" if any(r["state"] != "accepted" for r in deliveries) else
                         "success" if deliveries else "no_work"),
            "job_id": job_id, "events_enqueued": queued, "deliveries": deliveries,
            "display_verified": False, "read_verified": False}


def run_job(store: OutboxStore, job_id: str, *, now: datetime,
            provider_factory: Callable[[], FollowingProvider], sender: Sender,
            runtime: Path | None = None) -> dict[str, Any]:
    job = store.job(job_id)
    if runtime is not None and str(runtime.absolute()) != job["runtime"]:
        return {"outcome": "blocked", "reason": "runtime_mismatch", "job_id": job_id,
                "collection": None, "deliveries": []}
    if str(store.path.parent.absolute()) != job["workspace"]:
        return {"outcome": "blocked", "reason": "workspace_mismatch", "job_id": job_id,
                "collection": None, "deliveries": []}
    previous = next((r for r in store.jobs(now=now) if r["id"] == job_id), {})
    last_result = next((r["state"] for r in previous.get("runs", []) if r["state"] in {"success", "failed"}), None)
    window = store.claim_window(job_id, now=now)
    collection = None
    if window is not None:
        result = collect_live(store, job["target"], provider_factory, now=now)
        collection = {"state": result.state, "reason": result.reason, "window_id": window["id"],
                      "due_at": window["due_at"], "missed_windows": window["missed_windows"]}
        store.finish_window(window["id"], state=result.state, reason=result.reason, now=now,
                            block=result.state == "failed")
        if result.state == "failed":
            last_complete = store.status(job["target"])["last_success_at"] or "unknown"
            store.status_notice(job_id, identity=f"blocked:{window['id']}", now=now,
                payload=f"OrbitDiff could not complete the check for {job['target']}. "
                        f"Last complete observation: {last_complete}. No conclusion about new follows is available. "
                        "Automatic collection is blocked. Open alert status for the next step.")
        elif result.state == "success" and last_result == "failed":
            store.status_notice(job_id, identity=f"recovered:{window['id']}", now=now,
                payload=f"OrbitDiff completed a new observation for {job['target']}. "
                        "Collection has recovered; earlier gaps remain in the history.")
    delivery = deliver_job(store, job_id, now=now, sender=sender)
    delivery["collection"] = collection
    if collection:
        if collection["state"] != "success":
            delivery["outcome"] = "partial"
        elif delivery["outcome"] == "no_work":
            delivery["outcome"] = "success"
    elif job["state"] == "blocked" and delivery["outcome"] == "no_work":
        delivery["outcome"] = "blocked"
        delivery["reason"] = job["blocked_reason"]
    return delivery
