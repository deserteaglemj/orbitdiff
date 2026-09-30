"""Bounded native submissions; submission is not display or read evidence."""
from __future__ import annotations

import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Protocol

from .alert_outbox import OutboxStore

_SCRIPT = '''on run argv
    display notification (item 1 of argv) with title "OrbitDiff"
end run
'''


@dataclass(frozen=True)
class DeliveryResult:
    state: str
    detail: str


class Sender(Protocol):
    idempotent: bool

    def send(self, payload: str, key: str) -> DeliveryResult: ...


class MacOSSender:
    idempotent = False

    def send(self, payload: str, key: str) -> DeliveryResult:
        if sys.platform != "darwin":
            return DeliveryResult("failed", "unsupported_platform")
        try:
            result = subprocess.run(["/usr/bin/osascript", "-", payload], input=_SCRIPT,
                                    text=True, capture_output=True, shell=False, timeout=10, check=False)
        except OSError:
            return DeliveryResult("failed", "adapter_unavailable")
        except subprocess.TimeoutExpired:
            return DeliveryResult("uncertain", "submission_uncertain")
        if result.returncode != 0:
            # A nonzero result does not prove that no notification was submitted.
            return DeliveryResult("uncertain", "submission_uncertain")
        return DeliveryResult("accepted", "submitted_to_macos")


def dispatch(store: OutboxStore, job_id: str, sender: Sender, *, now: datetime) -> list[dict[str, Any]]:
    results = []
    started = time.monotonic()
    for _ in range(20):
        current = now + timedelta(seconds=time.monotonic()-started)
        notice = store.claim_notice(job_id, now=current, idempotent=sender.idempotent)
        if notice is None:
            break
        try:
            result = sender.send(notice["payload"], notice["key"])
        except Exception:
            result = DeliveryResult("uncertain", "submission_uncertain")
        current = now + timedelta(seconds=time.monotonic()-started)
        recorded = store.finish_notice(notice["id"], notice["lease_token"], state=result.state, detail=result.detail, now=current)
        if not recorded:
            result = DeliveryResult("uncertain", "submission_uncertain")
        results.append({"notice_id": notice["id"], "state": result.state, "detail": result.detail})
    return results
