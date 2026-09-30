from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from orbit_os.workspace import ensure_workspace


def run_cli(*arguments: str) -> subprocess.CompletedProcess[str]:
    environment = dict(os.environ, PYTHONPATH=str(Path(__file__).parents[1] / "src"))
    return subprocess.run(
        [sys.executable, "-m", "orbit_os", *arguments],
        env=environment, text=True, capture_output=True, timeout=20,
    )


def test_doctor_creates_only_selected_private_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "my-orbit"
    result = run_cli("doctor", "--workspace", str(workspace))
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["app"] == "orbit-os"
    assert payload["ready"] is True
    assert payload["personal_status"] == "missing"
    assert payload["watchlist_count"] == 0
    assert workspace.is_dir()
    if os.name != "nt":
        assert workspace.stat().st_mode & 0o777 == 0o700


def test_relationship_import_and_json_report_without_agent_or_hermes(tmp_path: Path) -> None:
    export = tmp_path / "export"
    export.mkdir()
    def row(username: str) -> dict[str, object]:
        return {"string_list_data": [{"value": username, "timestamp": 1}]}
    (export / "followers_1.json").write_text(json.dumps([row("nova_labs")]))
    (export / "following.json").write_text(json.dumps({
        "relationships_following": [row("nova_labs"), row("pixel_forge")],
    }))
    workspace = tmp_path / "workspace"
    result = run_cli("import", str(export), "--account", "atlas_studio",
                     "--captured-at", "2026-09-29T12:00:00Z", "--complete-followers",
                     "--complete-following", "--workspace", str(workspace))
    assert result.returncode == 0, result.stderr
    result = run_cli("relationships", "--workspace", str(workspace))
    assert result.returncode == 0, result.stderr
    accounts = {item["username"]: item for item in json.loads(result.stdout)["accounts"]}
    assert accounts["nova_labs"]["relationship"] == "mutual"
    assert accounts["pixel_forge"]["relationship"] == "not_following_back"
    report = run_cli("report", "--workspace", str(workspace), "--format", "json")
    assert report.returncode == 0, report.stderr
    assert json.loads(report.stdout)["personal"]["username"] == "atlas_studio"


def test_demo_is_isolated_and_never_populates_real_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    result = run_cli("demo", "--workspace", str(workspace))
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["demo"] is True
    assert payload["personal"]["metrics"]["mutuals"] >= 1
    assert payload["watchlist"]
    result = run_cli("status", "--workspace", str(workspace))
    real = json.loads(result.stdout)
    assert real["personal"]["status"] == "missing"
    assert real["watchlist"] == []


def test_login_requires_a_human_terminal_and_exposes_no_password_argument() -> None:
    result = run_cli("login", "atlas_studio")
    assert result.returncode == 2
    assert "terminal" in result.stderr.lower()
    result = run_cli("login", "atlas_studio", "--password", "synthetic-not-a-secret")
    assert result.returncode == 2
    assert "unrecognized" in result.stderr.lower()


def test_doctor_reports_corrupt_personal_state_as_not_ready(tmp_path: Path) -> None:
    directory = tmp_path / "personal"
    directory.mkdir()
    (directory / "snapshots.json").write_text("invalid synthetic state")
    result = run_cli("doctor", "--workspace", str(tmp_path))
    assert result.returncode == 4
    payload = json.loads(result.stdout)
    assert payload["ready"] is False
    assert payload["personal_status"] == "error"
    assert any(item["code"] == "personal_unreadable" for item in payload["issues"])


def test_corrupt_deflate_import_returns_a_safe_cli_error_without_changing_state(
    tmp_path: Path, corrupt_deflate_zip: bytes,
) -> None:
    source = tmp_path / "followers_1.json"
    source.write_text(json.dumps([{"string_list_data": [{"value": "nova_labs"}]}]))
    workspace = tmp_path / "workspace"
    seed = run_cli("import", str(source), "--account", "atlas_studio", "--workspace", str(workspace))
    assert seed.returncode == 0, seed.stderr
    saved = workspace / "personal" / "snapshots.json"
    before = saved.read_bytes()
    archive = tmp_path / "export.zip"
    archive.write_bytes(corrupt_deflate_zip)

    result = run_cli("import", str(archive), "--account", "atlas_studio", "--workspace", str(workspace))

    assert result.returncode == 2, result.stderr
    assert "ZIP" in result.stderr and "safely" in result.stderr
    assert "Traceback" not in result.stderr and "zlib" not in result.stderr
    assert result.stdout == ""
    assert saved.read_bytes() == before


def test_workspace_rejects_case_variant_protected_paths_before_mutation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    mutations: list[str] = []
    monkeypatch.setattr(Path, "mkdir", lambda *_args, **_kwargs: mutations.append("mkdir"))
    monkeypatch.setattr(Path, "chmod", lambda *_args, **_kwargs: mutations.append("chmod"))
    with pytest.raises(OSError, match="protected"):
        ensure_workspace(tmp_path / ".ENV" / "workspace")
    assert mutations == []
