from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal


@dataclass(frozen=True)
class Account:
    profile_id: str
    username: str


@dataclass(frozen=True)
class Collection:
    target: str
    reported_count: int
    accounts: tuple[Account, ...]
    complete: bool
    collected_at: datetime


@dataclass(frozen=True)
class Event:
    event_type: Literal["following_started", "following_stopped"]
    target: str
    actor_id: str
    username: str
    first_seen_at: str
    confirmed_at: str
    run_id: int = 0
