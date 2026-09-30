from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parents[1]
PREPARE = ROOT / "scripts" / "prepare_skill_evals.py"


def prepare(output: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(PREPARE), "--output-dir", str(output), "--synthetic-bundle"],
        capture_output=True, text=True, check=False, timeout=20,
    )


def fingerprint(directory: Path) -> dict[str, str]:
    return {str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in directory.rglob("*") if path.is_file()}


def test_generator_creates_separate_complete_scenarios_and_no_answer_keys_in_prompts(tmp_path: Path) -> None:
    result = prepare(tmp_path / "evals")
    assert result.returncode == 0, result.stderr
    manifest = json.loads(Path(json.loads(result.stdout)["manifest"]).read_text())
    assert len(manifest["cases"]) == 14
    for case in manifest["cases"]:
        prompt = Path(case["prompt_file"]).read_text()
        assert "assertions" not in prompt and "expected_output" not in prompt
        context = json.loads(Path(case["context_file"]).read_text())
        assert context["variant"] in {"with_skill", "old_skill"}
        assert all(Path(path).exists() for path in case["files"])
        assert str(tmp_path / "evals") in context["write_workspace"]
    by_case = {(item["id"], item["variant"]): item for item in manifest["cases"]}
    first = Path(by_case[(3, "with_skill")]["context_file"])
    second = Path(by_case[(3, "old_skill")]["context_file"])
    first_context, second_context = json.loads(first.read_text()), json.loads(second.read_text())
    first_database = Path(first_context["source_workspace"]) / "orbitdiff.sqlite3"
    second_database = Path(second_context["source_workspace"]) / "orbitdiff.sqlite3"
    assert first_database != second_database
    assert first_database.read_bytes() == second_database.read_bytes()
    with sqlite3.connect(f"file:{first_database}?mode=ro", uri=True) as connection:
        assert connection.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM edges WHERE pending_present = 0").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM runs WHERE state = 'failed'").fetchone()[0] == 1
    if os.name != "nt":
        assert first_database.stat().st_mode & 0o222 == 0


def test_generated_app_path_launcher_runs_without_path_command_or_default_data(tmp_path: Path) -> None:
    result = prepare(tmp_path / "evals")
    assert result.returncode == 0, result.stderr
    manifest = json.loads(Path(json.loads(result.stdout)["manifest"]).read_text())
    case = next(item for item in manifest["cases"] if item["id"] == 7 and item["variant"] == "with_skill")
    context = json.loads(Path(case["context_file"]).read_text())
    assert context["runtime_kind"] == "synthetic app-path launcher; not native-package validation"
    executable = context["orbit_os_executable"]
    before = fingerprint(Path(case["context_file"]).parent / "fixtures")
    demo = subprocess.run([executable, "demo"], capture_output=True, text=True, check=False, timeout=20)
    assert demo.returncode == 0, demo.stderr
    assert json.loads(demo.stdout)["workspace"]["demo"] is True
    status = subprocess.run(
        [executable, "status", "--workspace", context["write_workspace"]],
        capture_output=True, text=True, check=False, timeout=20,
    )
    assert status.returncode == 0, status.stderr
    assert json.loads(status.stdout)["watchlist"] == []
    assert fingerprint(Path(case["context_file"]).parent / "fixtures") == before


def test_generator_refuses_to_overwrite_existing_evaluation_workspace(tmp_path: Path) -> None:
    output = tmp_path / "evals"
    assert prepare(output).returncode == 0
    before = fingerprint(output)
    result = prepare(output)
    assert result.returncode == 1
    assert "empty" in result.stderr.lower()
    assert fingerprint(output) == before
