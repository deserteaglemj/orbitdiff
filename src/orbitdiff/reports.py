from __future__ import annotations

import json
import os
import string
import tempfile
from collections.abc import Iterable
from pathlib import Path

from orbitdiff.models import Event


def _event_payload(event: Event) -> dict[str, str | int]:
    return {
        "target": event.target,
        "actor_id": event.actor_id,
        "username": event.username,
        "event_type": event.event_type,
        "first_seen_at": event.first_seen_at,
        "confirmed_at": event.confirmed_at,
        "run_id": event.run_id,
    }


def _private_parent(path: Path) -> None:
    missing: list[Path] = []
    parent = path.parent
    while not parent.exists():
        missing.append(parent)
        parent = parent.parent
    for directory in reversed(missing):
        try:
            directory.mkdir(mode=0o700)
        except FileExistsError:
            pass


def write_report(path: Path, content: str) -> None:
    _private_parent(path)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_path, 0o600)
        os.replace(temporary_path, path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def render_json(target: str, events: Iterable[Event]) -> str:
    return json.dumps(
        {"target": target, "events": [_event_payload(event) for event in events]},
        indent=2,
        sort_keys=True,
    ) + "\n"


def _markdown_text(value: str) -> str:
    entities = {"&": "&amp;", "<": "&lt;", ">": "&gt;"}
    parts = []
    for character in value:
        if character < " " or character == "\x7f":
            continue
        if character in entities:
            parts.append(entities[character])
        elif character in string.punctuation:
            parts.append("\\" + character)
        else:
            parts.append(character)
    return "".join(parts)


def render_markdown(target: str, events: Iterable[Event]) -> str:
    rows = list(events)
    lines = [f"# OrbitDiff report: {_markdown_text(target)}", ""]
    if not rows:
        return "\n".join([*lines, "No confirmed changes.", ""])
    lines.extend(
        [
            "| Event | Account | First observed | Confirmed | Run |",
            "| --- | --- | --- | --- | ---: |",
        ]
    )
    for event in rows:
        lines.append(
            f"| {_markdown_text(event.event_type)} | {_markdown_text(event.username)} ({_markdown_text(event.actor_id)}) | {_markdown_text(event.first_seen_at)} | {_markdown_text(event.confirmed_at)} | {_markdown_text(str(event.run_id))} |"
        )
    return "\n".join([*lines, ""])
