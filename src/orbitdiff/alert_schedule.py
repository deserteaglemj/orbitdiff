"""Daily eligibility; a host wakeup is separate evidence."""
from __future__ import annotations

import re
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("an aware timestamp is required")
    return value.astimezone(UTC)


def schedule_parts(time: str, timezone: str) -> tuple[int, int, ZoneInfo]:
    if not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", time):
        raise ValueError("daily time must be HH:MM in 24-hour time")
    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ValueError("a supported IANA timezone is required") from error
    hour, minute = (int(part) for part in time.split(":"))
    return hour, minute, zone


def _on_day(day: date, hour: int, minute: int, zone: ZoneInfo) -> datetime:
    wall = datetime(day.year, day.month, day.day, hour, minute)
    # fold=0 selects the first occurrence. Round-trip validation detects gaps.
    for offset in range(24 * 60 + 1):
        candidate = wall + timedelta(minutes=offset)
        instant = candidate.replace(tzinfo=zone, fold=0).astimezone(UTC)
        if instant.astimezone(zone).replace(tzinfo=None) == candidate:
            return instant
    raise ValueError("daily time could not be resolved")


def daily_due(now: datetime, time: str, timezone: str) -> datetime:
    current = aware(now)
    hour, minute, zone = schedule_parts(time, timezone)
    day = current.astimezone(zone).date()
    candidates = [_on_day(day - timedelta(days=i), hour, minute, zone) for i in range(3)]
    return max(value for value in candidates if value <= current)


def next_due(now: datetime, time: str, timezone: str) -> datetime:
    current = aware(now)
    hour, minute, zone = schedule_parts(time, timezone)
    day = current.astimezone(zone).date()
    candidates = [_on_day(day + timedelta(days=i), hour, minute, zone) for i in range(3)]
    return min(value for value in candidates if value > current)
