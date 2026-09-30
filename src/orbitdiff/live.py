"""One bounded live attempt shared by manual and scheduled entry points."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from .alert_schedule import aware
from .models import Event
from .providers.base import (
    CollectionIncompleteError,
    FollowingProvider,
    InvalidTargetError,
    PrivateTargetError,
    ProviderError,
    SessionUnavailableError,
    normalize_target,
    validate_collection,
)
from .store import GraphStore, StaleAttemptError

MESSAGES = {
    "cooldown": "scan cooldown active; wait 30 minutes before another live scan",
    "baseline_exists": "target already has a baseline; use an ordinary scan for later observations",
    "stale_attempt": "a newer live attempt owns this target; old result discarded",
    "session_unavailable": "saved Instaloader session file was not found or unavailable",
    "private_target": "private targets are not supported",
    "invalid_target": "target must be a public Instagram username",
    "incomplete": "public following collection was incomplete; last good evidence retained",
    "provider_failed": "public following collection failed; cause unknown",
}


@dataclass(frozen=True)
class LiveResult:
    state: str
    reason: str | None = None
    events: tuple[Event, ...] = ()


def collect_live(store: GraphStore, target: str, provider_factory: Callable[[], FollowingProvider],
                 *, now: datetime, baseline: bool = False,
                 cooldown: timedelta = timedelta(minutes=30)) -> LiveResult:
    current = aware(now)
    target = normalize_target(target)
    if not store.reserve_live_attempt(target, now=current, cooldown=cooldown):
        return LiveResult("skipped", "cooldown")
    if baseline and store.status(target)["initialized"]:
        return LiveResult("skipped", "baseline_exists")
    try:
        collection = provider_factory().collect(target)
        if collection.target != target:
            raise CollectionIncompleteError("provider returned a different target")
        validate_collection(collection)
        events = store.apply_collection(collection, baseline_run=baseline, attempted_at=current)
        return LiveResult("success", events=tuple(events))
    except StaleAttemptError:
        return LiveResult("skipped", "stale_attempt")
    except ProviderError as error:
        reason = ("session_unavailable" if isinstance(error, SessionUnavailableError) else
                  "private_target" if isinstance(error, PrivateTargetError) else
                  "invalid_target" if isinstance(error, InvalidTargetError) else
                  "incomplete" if isinstance(error, CollectionIncompleteError) else "provider_failed")
        try:
            store.record_failed_run(target, MESSAGES[reason], baseline_run=baseline,
                                    attempted_at=current, now=current)
        except StaleAttemptError:
            return LiveResult("skipped", "stale_attempt")
        return LiveResult("failed", reason)
