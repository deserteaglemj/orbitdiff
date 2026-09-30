from __future__ import annotations

import io
import json
import os
import stat
import struct
import subprocess
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
from typing import Any

import pytest

from orbit_os import personal
from orbit_os.personal import import_export, import_files, load_personal


def stamp(days: int = 0) -> str:
    return (datetime.now(UTC) - timedelta(days=days)).isoformat(timespec="seconds")


def roster(*handles: str, following: bool = False) -> bytes:
    rows = [
        {
            "title": handle if following else "",
            "media_list_data": [],
            "string_list_data": [{
                "href": f"https://www.instagram.com/{handle}/",
                **({} if following else {"value": handle}),
                "timestamp": 1600000000,
            }],
        }
        for handle in handles
    ]
    return json.dumps({"relationships_following": rows} if following else rows).encode()


def files(*followers: str, following: tuple[str, ...] = ("nova_labs", "pixel_forge")) -> dict[str, bytes]:
    return {
        "followers_1.json": roster(*followers),
        "following.json": roster(*following, following=True),
    }


def archive(members: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as bundle:
        for name, content in members.items():
            bundle.writestr(name, content)
    return buffer.getvalue()


def do_import(workspace: Path, payload: dict[str, bytes], **kwargs: Any) -> dict[str, Any]:
    return import_files(payload, workspace, account="atlas_studio", **kwargs)


def test_missing_workspace_is_not_created_or_reported_as_empty(tmp_path: Path) -> None:
    workspace = tmp_path / "new"
    view = load_personal(workspace)
    assert view["status"] == "missing"
    assert view["metrics"]["followers"] is None
    assert not workspace.exists()


def test_abandoned_import_lock_does_not_permanently_block_workspace(tmp_path: Path) -> None:
    directory = tmp_path / "personal"
    directory.mkdir()
    (directory / ".import.lock").touch(mode=0o600)
    view = do_import(tmp_path, files("nova_labs"), captured_at=stamp())
    assert view["status"] == "degraded"


def test_process_crash_releases_import_lock(tmp_path: Path) -> None:
    program = """import os, sys
from pathlib import Path
from orbit_os import personal
personal._write_state = lambda *args: os._exit(17)
personal.import_files({'followers_1.json': b'[]'}, Path(sys.argv[1]), account='atlas_studio')
"""
    environment = dict(os.environ, PYTHONPATH=str(Path(__file__).parents[1] / "src"))
    result = subprocess.run([sys.executable, "-c", program, str(tmp_path)], env=environment,
                            capture_output=True, timeout=20)
    assert result.returncode == 17
    view = do_import(tmp_path, files("nova_labs"), captured_at=stamp())
    assert view["username"] == "atlas_studio"


def test_official_shapes_keep_relationship_unknown_without_coverage(tmp_path: Path) -> None:
    view = do_import(tmp_path, files("nova_labs", "lunar_arch"), captured_at=stamp())
    by_name = {row["username"]: row for row in view["accounts"]}
    assert by_name["nova_labs"]["relationship"] == "mutual"
    assert by_name["pixel_forge"]["followed_by"] is None
    assert by_name["pixel_forge"]["relationship"] == "unknown"
    assert by_name["lunar_arch"]["following"] is None
    assert view["metrics"]["followers"] is None
    assert view["metrics"]["followers_observed"] == 2
    assert view["metrics"]["not_following_back"] is None
    assert view["provenance"]["source"] == "instagram_export"
    assert view["provenance"]["identity_basis"] == "username"
    assert view["provenance"]["automatic_refresh"] is False
    assert view["events"] == []


def test_user_declared_complete_export_supports_absence_with_provenance(tmp_path: Path) -> None:
    view = do_import(
        tmp_path, files("nova_labs", "lunar_arch"), captured_at=stamp(),
        complete_followers=True, complete_following=True,
    )
    by_name = {row["username"]: row for row in view["accounts"]}
    assert by_name["pixel_forge"]["relationship"] == "not_following_back"
    assert by_name["lunar_arch"]["relationship"] == "follows_you"
    assert view["metrics"]["followers"] == 2
    assert view["metrics"]["following"] == 2
    assert view["coverage_details"]["followers"]["basis"] == "user_declared"
    assert view["coverage_details"]["followers"]["independently_verified"] is False
    assert view["coverage_details"]["followers"]["complete"] is True


def test_directory_import_reads_only_relationship_files_and_preserves_source(tmp_path: Path) -> None:
    source, workspace = tmp_path / "export", tmp_path / "workspace"
    entries = source / "connections" / "followers_and_following"
    entries.mkdir(parents=True)
    for name, content in files("nova_labs").items():
        (entries / name).write_bytes(content)
    (source / "messages.json").write_bytes(b"unrelated private payload")
    before = {path.name: path.read_bytes() for path in entries.iterdir()}
    view = import_export(source, workspace, account="atlas_studio", captured_at=stamp())
    assert view["metrics"]["followers_observed"] == 1
    assert before == {path.name: path.read_bytes() for path in entries.iterdir()}
    saved = (workspace / "personal" / "snapshots.json").read_text()
    assert "unrelated private payload" not in saved
    assert "https://" not in saved
    assert str(source) not in saved


def test_zip_import_merges_split_followers_without_extracting_unrelated_data(tmp_path: Path) -> None:
    root = "export/connections/followers_and_following/"
    payload = {
        root + "followers_1.json": roster("nova_labs"),
        root + "followers_2.json": roster("pixel_forge", "nova_labs"),
        root + "following.json": roster("nova_labs", following=True),
        "messages/inbox.json": b"not valid JSON, never read",
    }
    view = do_import(tmp_path, {"export.zip": archive(payload)}, captured_at=stamp(), complete_followers=True)
    assert view["metrics"]["followers"] == 2
    assert view["coverage_details"]["followers"]["shards"] == [1, 2]
    assert not (tmp_path / "messages").exists()


def test_zip_file_source_matches_uploaded_zip(tmp_path: Path) -> None:
    source = tmp_path / "export.zip"
    source.write_bytes(archive(files("nova_labs")))
    captured = stamp()
    one = import_export(source, tmp_path / "one", account="atlas_studio", captured_at=captured)
    two = do_import(tmp_path / "two", {"export.zip": source.read_bytes()}, captured_at=captured)
    assert one["snapshot_id"] == two["snapshot_id"]
    assert one["accounts"] == two["accounts"]


def test_corrupt_deflate_preserves_the_saved_personal_state(
    tmp_path: Path, corrupt_deflate_zip: bytes,
) -> None:
    do_import(tmp_path, files("nova_labs"), captured_at=stamp(1))
    saved = tmp_path / "personal" / "snapshots.json"
    before = saved.read_bytes()

    with pytest.raises(ValueError, match="ZIP.*safely"):
        do_import(tmp_path, {"export.zip": corrupt_deflate_zip}, captured_at=stamp())

    assert saved.read_bytes() == before
    assert load_personal(tmp_path)["metrics"]["followers_observed"] == 1


@pytest.mark.parametrize("names", [("followers_2.json",), ("followers_1.json", "followers_3.json")])
def test_missing_shards_cannot_be_declared_complete(tmp_path: Path, names: tuple[str, ...]) -> None:
    payload = {name: roster("nova_labs") for name in names}
    payload["following.json"] = roster("pixel_forge", following=True)
    view = do_import(tmp_path, payload, captured_at=stamp(), complete_followers=True)
    assert view["coverage_details"]["followers"]["complete"] is False
    assert view["coverage_details"]["followers"]["declared_complete"] is True
    assert view["coverage_details"]["followers"]["shards_contiguous"] is False
    assert view["accounts"][1]["followed_by"] is None
    assert view["metrics"]["followers"] is None


def test_unknown_capture_is_not_taken_from_relationship_timestamp_or_file_mtime(tmp_path: Path) -> None:
    view = do_import(tmp_path, files("nova_labs"), complete_followers=True, complete_following=True)
    assert view["last_success_at"] is None
    assert view["stale"] is True
    assert view["coverage_details"]["followers"]["complete"] is False
    assert view["provenance"]["capture_time_basis"] == "unknown"
    assert view["status"] == "degraded"


def test_missing_direction_never_becomes_a_zero_even_with_declaration(tmp_path: Path) -> None:
    view = do_import(
        tmp_path, {"following.json": roster("nova_labs", following=True)},
        captured_at=stamp(), complete_followers=True, complete_following=True,
    )
    assert view["metrics"]["followers"] is None
    assert view["metrics"]["followers_observed"] is None
    assert view["accounts"][0]["followed_by"] is None
    assert view["coverage_details"]["followers"]["present"] is False


def test_present_empty_complete_direction_is_distinct_from_missing(tmp_path: Path) -> None:
    view = do_import(
        tmp_path, files(), captured_at=stamp(), complete_followers=True, complete_following=True,
    )
    assert view["metrics"]["followers"] == 0
    assert view["metrics"]["not_following_back"] == 2


def test_duplicate_same_capture_does_not_append_history(tmp_path: Path) -> None:
    capture = stamp()
    one = do_import(tmp_path, files("nova_labs"), captured_at=capture)
    two = do_import(tmp_path, files("nova_labs"), captured_at=capture)
    assert one["snapshot_id"] == two["snapshot_id"]
    assert two["import_result"]["duplicate"] is True
    assert len(two["runs"]) == 1


def test_newer_capture_with_identical_roster_is_a_fresh_observation(tmp_path: Path) -> None:
    do_import(tmp_path, files("nova_labs"), captured_at=stamp(3))
    view = do_import(tmp_path, files("nova_labs"), captured_at=stamp())
    assert view["last_success_at"] == stamp()
    assert len(view["runs"]) == 2
    assert view["import_result"]["duplicate"] is False
    assert view["events"] == []


def test_older_and_unknown_imports_never_replace_newer_current_snapshot(tmp_path: Path) -> None:
    one = do_import(tmp_path, files("nova_labs"), captured_at=stamp())
    old = do_import(tmp_path, files("pixel_forge"), captured_at=stamp(2))
    undated = do_import(tmp_path, files("lunar_arch"))
    assert old["snapshot_id"] == one["snapshot_id"] == undated["snapshot_id"]
    assert old["import_result"]["current"] is False
    assert undated["import_result"]["current"] is False
    assert len(undated["runs"]) == 3


def test_second_unknown_snapshot_cannot_displace_first_unknown(tmp_path: Path) -> None:
    one = do_import(tmp_path, files("nova_labs"))
    two = do_import(tmp_path, files("pixel_forge"))
    assert two["snapshot_id"] == one["snapshot_id"]
    assert two["import_result"]["current"] is False


def test_unknown_snapshot_can_gain_explicit_capture_provenance(tmp_path: Path) -> None:
    do_import(tmp_path, files("nova_labs"))
    view = do_import(tmp_path, files("nova_labs"), captured_at=stamp(), complete_followers=True)
    assert view["last_success_at"] == stamp()
    assert view["coverage_details"]["followers"]["complete"] is True
    assert len(view["runs"]) == 1
    assert view["events"] == []


def test_owner_binding_rejects_mixed_accounts_without_state_change(tmp_path: Path) -> None:
    one = do_import(tmp_path, files("nova_labs"), captured_at=stamp())
    with pytest.raises(ValueError, match="account"):
        import_files(files("pixel_forge"), tmp_path, account="nova_labs", captured_at=stamp())
    assert load_personal(tmp_path)["snapshot_id"] == one["snapshot_id"]


def test_explicit_export_owner_must_match_selected_account(tmp_path: Path) -> None:
    document = {"account": "nova_labs", "relationships_followers": []}
    with pytest.raises(ValueError, match="account"):
        do_import(tmp_path, {"followers.json": json.dumps(document).encode()}, captured_at=stamp())
    assert not (tmp_path / "personal").exists()


def test_multiple_export_roots_are_rejected_as_ambiguous(tmp_path: Path) -> None:
    payload = {
        "one/connections/followers_and_following/followers_1.json": roster("nova_labs"),
        "two/connections/followers_and_following/following.json": roster("pixel_forge", following=True),
    }
    with pytest.raises(ValueError, match="scope|root|ambiguous"):
        do_import(tmp_path, {"export.zip": archive(payload)}, captured_at=stamp())


@pytest.mark.parametrize("name", ["../followers_1.json", "/followers_1.json", "C:/followers_1.json", "a\\followers_1.json"])
def test_unsafe_uploaded_paths_rejected(tmp_path: Path, name: str) -> None:
    with pytest.raises(ValueError, match="path"):
        do_import(tmp_path, {"export.zip": archive({name: roster("nova_labs")})})


def test_symlink_archive_member_is_rejected(tmp_path: Path) -> None:
    info = zipfile.ZipInfo("followers_1.json")
    info.create_system = 3
    info.external_attr = (stat.S_IFLNK | 0o777) << 16
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr(info, "somewhere.json")
    with pytest.raises(ValueError, match="regular|link"):
        do_import(tmp_path, {"export.zip": buffer.getvalue()})


def test_symlink_sources_and_workspaces_are_rejected(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    real = tmp_path / "real.json"
    real.write_bytes(roster("nova_labs"))
    (source / "followers_1.json").symlink_to(real)
    with pytest.raises((OSError, ValueError), match="link|regular"):
        import_export(source, tmp_path / "workspace", account="atlas_studio")
    linked = tmp_path / "linked"
    linked.symlink_to(source, target_is_directory=True)
    with pytest.raises((OSError, ValueError), match="link"):
        do_import(linked, files("nova_labs"))


@pytest.mark.parametrize("component", [".env", ".env.local", ".ssh"])
def test_protected_source_and_workspace_paths_rejected_before_read(tmp_path: Path, component: str) -> None:
    with pytest.raises(ValueError, match="protected"):
        import_export(tmp_path / component / "followers_1.json", tmp_path / "safe", account="atlas_studio")
    with pytest.raises(ValueError, match="protected"):
        do_import(tmp_path / component, files("nova_labs"))


@pytest.mark.parametrize("payload", [b"not-json", b"{}", b"null", b'[{}]', b'[{"string_list_data":[]}]'])
def test_malformed_relationship_files_rejected_atomically(tmp_path: Path, payload: bytes) -> None:
    do_import(tmp_path, files("nova_labs"), captured_at=stamp())
    path = tmp_path / "personal" / "snapshots.json"
    before = path.read_bytes()
    with pytest.raises(ValueError):
        do_import(tmp_path, {"followers_1.json": payload}, captured_at=stamp())
    assert path.read_bytes() == before


def test_conflicting_handle_fields_are_rejected(tmp_path: Path) -> None:
    payload = json.loads(roster("nova_labs", following=True))
    payload["relationships_following"][0]["string_list_data"][0]["value"] = "pixel_forge"
    with pytest.raises(ValueError, match="conflict|handle"):
        do_import(tmp_path, {"following.json": json.dumps(payload).encode()})


@pytest.mark.parametrize("capture", ["2026-01-01", "not-a-date", "2999-01-01T00:00:00Z"])
def test_invalid_or_future_capture_is_rejected(tmp_path: Path, capture: str) -> None:
    with pytest.raises(ValueError, match="capture"):
        do_import(tmp_path, files("nova_labs"), captured_at=capture)


def test_size_limits_apply_to_uploads_and_decompressed_members(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(personal, "MAX_FILE_BYTES", 64)
    with pytest.raises(ValueError, match="limit|large|size"):
        do_import(tmp_path, {"followers_1.json": b" " * 65})
    with pytest.raises(ValueError, match="limit|large|size"):
        do_import(tmp_path, {"export.zip": archive({"followers_1.json": b" " * 65})})


def test_archive_member_count_is_bounded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(personal, "MAX_FILES", 2)
    with pytest.raises(ValueError, match="limit|many"):
        do_import(tmp_path, {"export.zip": archive({"one.txt": b"", "two.txt": b"", "followers_1.json": b"[]"})})


def test_observed_export_events_are_not_live_confirmations(tmp_path: Path) -> None:
    do_import(
        tmp_path, files("nova_labs", following=("nova_labs",)), captured_at=stamp(2),
        complete_followers=True, complete_following=True,
    )
    view = do_import(
        tmp_path, files("pixel_forge", following=("nova_labs", "lunar_arch")), captured_at=stamp(),
        complete_followers=True, complete_following=True,
    )
    assert {(event["type"], event["username"]) for event in view["events"]} == {
        ("follower_observed_removed", "nova_labs"),
        ("follower_observed_added", "pixel_forge"),
        ("following_observed_added", "lunar_arch"),
    }
    assert all(event["source"] == "export_observation" for event in view["events"])
    assert all(event["evidence"] == "observed" for event in view["events"])


def test_partial_exports_do_not_create_absence_based_events(tmp_path: Path) -> None:
    do_import(tmp_path, files("nova_labs"), captured_at=stamp(2))
    view = do_import(tmp_path, files("pixel_forge"), captured_at=stamp())
    assert view["events"] == []


def test_same_capture_with_conflicting_rosters_is_rejected(tmp_path: Path) -> None:
    capture = stamp()
    one = do_import(tmp_path, files("nova_labs"), captured_at=capture)
    with pytest.raises(ValueError, match="capture|conflict"):
        do_import(tmp_path, files("pixel_forge"), captured_at=capture)
    assert load_personal(tmp_path)["snapshot_id"] == one["snapshot_id"]


def test_storage_is_private_and_loading_does_not_modify_it(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    do_import(workspace, files("nova_labs"), captured_at=stamp())
    directory = workspace / "personal"
    path = directory / "snapshots.json"
    assert stat.S_IMODE(directory.stat().st_mode) == 0o700
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    before = path.read_bytes(), path.stat().st_mtime_ns
    load_personal(workspace)
    assert before == (path.read_bytes(), path.stat().st_mtime_ns)
    assert {item.name for item in directory.iterdir()} == {"snapshots.json", ".import.lock"}


def test_corrupt_owned_state_fails_closed_without_raw_content(tmp_path: Path) -> None:
    directory = tmp_path / "personal"
    directory.mkdir()
    path = directory / "snapshots.json"
    path.write_text("private invalid data")
    view = load_personal(tmp_path)
    assert view["status"] == "error"
    assert "private invalid data" not in json.dumps(view)
    with pytest.raises(ValueError):
        do_import(tmp_path, files("nova_labs"))
    assert path.read_text() == "private invalid data"


def test_history_bound_rejects_without_discarding_evidence(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(personal, "MAX_SNAPSHOTS", 1)
    one = do_import(tmp_path, files("nova_labs"), captured_at=stamp(2))
    with pytest.raises(ValueError, match="history|limit"):
        do_import(tmp_path, files("pixel_forge"), captured_at=stamp())
    assert load_personal(tmp_path)["snapshot_id"] == one["snapshot_id"]


def test_duplicate_can_strengthen_explicit_coverage_without_an_extra_observation(tmp_path: Path) -> None:
    capture = stamp()
    do_import(tmp_path, files("nova_labs"), captured_at=capture)
    view = do_import(tmp_path, files("nova_labs"), captured_at=capture, complete_followers=True)
    assert view["import_result"]["duplicate"] is True
    assert view["coverage_details"]["followers"]["complete"] is True
    assert len(view["runs"]) == 1


def test_replace_failure_preserves_previous_state_and_releases_lock(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    do_import(tmp_path, files("nova_labs"), captured_at=stamp(2))
    path = tmp_path / "personal" / "snapshots.json"
    before = path.read_bytes()

    def fail_replace(*args: Any) -> None:
        raise OSError("simulated storage failure")

    monkeypatch.setattr(personal.os, "replace", fail_replace)
    with pytest.raises(OSError, match="storage failure"):
        do_import(tmp_path, files("pixel_forge"), captured_at=stamp())
    assert path.read_bytes() == before
    assert {item.name for item in path.parent.iterdir()} == {"snapshots.json", ".import.lock"}


def test_concurrent_owner_initialization_does_not_cross_account_boundaries(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    entered, release = Event(), Event()
    real_write = personal._write_state

    def pause_write(path: Path, payload: bytes) -> None:
        entered.set()
        assert release.wait(timeout=5)
        real_write(path, payload)

    monkeypatch.setattr(personal, "_write_state", pause_write)
    with ThreadPoolExecutor(max_workers=1) as executor:
        first = executor.submit(do_import, tmp_path, files("nova_labs"), captured_at=stamp())
        assert entered.wait(timeout=5)
        try:
            with pytest.raises(ValueError, match="active"):
                import_files(files("pixel_forge"), tmp_path, account="nova_labs", captured_at=stamp())
        finally:
            release.set()
        assert first.result()["username"] == "atlas_studio"
    assert load_personal(tmp_path)["username"] == "atlas_studio"


def test_malformed_stored_coverage_has_a_safe_import_error(tmp_path: Path) -> None:
    do_import(tmp_path, files("nova_labs"), captured_at=stamp())
    path = tmp_path / "personal" / "snapshots.json"
    state = json.loads(path.read_bytes())
    state["snapshots"][0]["shards"] = "invalid stored shape"
    path.write_text(json.dumps(state))
    with pytest.raises(ValueError, match="coverage"):
        do_import(tmp_path, files("pixel_forge"), captured_at=stamp(1))
    assert load_personal(tmp_path)["status"] == "error"


def test_archive_entry_limit_is_checked_before_allocating_central_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    payload = struct.pack("<4s4H2LH", b"PK\x05\x06", 0, 0, 2000, 2000, 0, 0, 0)

    def forbidden_archive(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("Central directory must not be parsed before the entry bound.")

    monkeypatch.setattr(personal.zipfile, "ZipFile", forbidden_archive)
    with pytest.raises(ValueError, match="limit|many"):
        do_import(tmp_path, {"export.zip": payload})
