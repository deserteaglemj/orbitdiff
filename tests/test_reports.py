from __future__ import annotations

import json
import os
import stat

from orbitdiff import reports
from orbitdiff.models import Event
from orbitdiff.reports import render_json, render_markdown


def unsafe_event() -> Event:
    return Event(
        event_type="following_started",
        target="atlas_studio",
        actor_id="1",
        username="<bad|name>\x00",
        first_seen_at="2026-09-11T12:00:00+00:00",
        confirmed_at="2026-09-11T12:30:00+00:00",
        run_id=9,
    )


def test_json_report_is_parseable_and_contains_only_event_fields() -> None:
    payload = json.loads(render_json("atlas_studio", [unsafe_event()]))

    assert payload["target"] == "atlas_studio"
    assert payload["events"][0]["actor_id"] == "1"
    assert "full_name" not in payload["events"][0]


def test_markdown_report_escapes_html_pipes_and_control_characters() -> None:
    report = render_markdown("atlas_studio", [unsafe_event()])

    assert "&lt;bad\\|name&gt;" in report
    assert "\x00" not in report


def test_write_report_uses_private_directory_and_atomic_private_file(tmp_path) -> None:
    new_output = tmp_path / "new" / "reports" / "report.md"
    original_umask = os.umask(0)
    try:
        reports.write_report(new_output, "first\n")
    finally:
        os.umask(original_umask)

    assert new_output.read_text() == "first\n"
    assert stat.S_IMODE(new_output.parent.stat().st_mode) == 0o700
    assert stat.S_IMODE(new_output.stat().st_mode) == 0o600

    existing_parent = tmp_path / "existing"
    existing_parent.mkdir(mode=0o755)
    os.chmod(existing_parent, 0o755)
    existing_output = existing_parent / "report.md"
    existing_output.write_text("old\n")
    os.chmod(existing_output, 0o644)

    reports.write_report(existing_output, "new\n")

    assert existing_output.read_text() == "new\n"
    assert stat.S_IMODE(existing_parent.stat().st_mode) == 0o755
    assert stat.S_IMODE(existing_output.stat().st_mode) == 0o600
