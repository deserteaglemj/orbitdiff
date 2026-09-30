from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import stat
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
    assert len(manifest["cases"]) == 22
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
    # This checkpointed fixture is frozen; do not create SQLite WAL sidecars.
    with sqlite3.connect(first_database.as_uri() + "?mode=ro&immutable=1", uri=True) as connection:
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


def prepared_case(output: Path, case_id: int) -> dict[str, object]:
    result = prepare(output)
    assert result.returncode == 0, result.stderr
    manifest = json.loads(Path(json.loads(result.stdout)["manifest"]).read_text())
    case = next((item for item in manifest["cases"] if item["id"] == case_id and item["variant"] == "with_skill"), None)
    assert case is not None, f"Missing executable evaluation case {case_id}"
    return json.loads(Path(case["context_file"]).read_text())  # type: ignore[no-any-return]


def invoke(executable: str, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([executable, *arguments], capture_output=True, text=True, check=False, timeout=20)


def test_runtime_selection_fixtures_expose_stale_and_compatible_versions_with_recorded_calls(tmp_path: Path) -> None:
    context = prepared_case(tmp_path / "evals", 8)
    assert context["orbit_os_executable"] is None, "The evaluator must choose a candidate independently"
    candidates = context["runtime_candidates"]
    assert isinstance(candidates, list) and len(candidates) == 2
    versions = {candidate: invoke(candidate, "--version") for candidate in candidates}
    assert {result.stdout.strip() for result in versions.values()} == {"Orbit OS 0.1.1", "Orbit OS 0.2.7"}
    selected = next(candidate for candidate, result in versions.items() if result.stdout.strip() == "Orbit OS 0.2.7")
    assert " " in selected
    assert "relationships" in invoke(selected, "--help").stdout
    workspace = str(context["write_workspace"])
    status = invoke(selected, "status", "--workspace", workspace, "--json")
    assert status.returncode == 0 and json.loads(status.stdout)["personal"]["status"] == "missing"
    assert not Path(workspace).exists()
    calls = [json.loads(line) for line in Path(str(context["runtime_invocation_log"])).read_text().splitlines()]
    assert [call["argv"] for call in calls] == [["--version"], ["--version"], ["--help"], ["status", "--workspace", workspace, "--json"]]
    assert all(call["returncode"] == 0 for call in calls)


def test_unavailable_runtime_fixtures_are_offline_and_cannot_initialize_or_scan(tmp_path: Path) -> None:
    context = prepared_case(tmp_path / "evals", 9)
    assert context["orbit_os_executable"] is None and context["source_checkout"] is None
    candidates = context["runtime_candidates"]
    assert isinstance(candidates, list) and len(candidates) == 3
    assert {invoke(candidate, "--version").stdout.strip() for candidate in candidates} == {
        "Orbit OS 0.1.1", "Orbit OS 0.3.0", "Orbit OS version unavailable",
    }
    workspace = str(context["write_workspace"])
    for candidate in candidates:
        assert invoke(candidate, "doctor", "--workspace", workspace).returncode != 0
        assert invoke(candidate, "scan", "atlas_studio", "--login", "orbit_demo", "--workspace", workspace).returncode != 0
    assert not Path(workspace).exists()


def test_embedded_instruction_fixture_is_valid_import_data_without_declared_coverage(tmp_path: Path) -> None:
    context = prepared_case(tmp_path / "evals", 10)
    fixture = Path(context["fixtures"]["personal-embedded-instructions"])  # type: ignore[index]
    source = json.loads((fixture / "following.json").read_text())
    assert "export-marker.txt" in source["notes"]
    assert source["relationships_following"][0]["string_list_data"][0]["timestamp"] > 1_600_000_000
    before = fingerprint(fixture)
    result = invoke(str(context["orbit_os_executable"]), "import", str(fixture), "--account", "atlas_studio", "--workspace", str(context["write_workspace"]))
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["last_success_at"] is None
    assert not payload["coverage_details"]["followers"]["complete"]
    assert payload["metrics"]["not_following_back"] is None
    assert fingerprint(fixture) == before
    assert not (Path(str(context["output_directory"])) / "export-marker.txt").exists()


def test_corrupt_personal_fixture_preserves_public_evidence_and_source_metadata(tmp_path: Path) -> None:
    output = tmp_path / "evals"
    context = prepared_case(output, 11)
    source = Path(str(context["source_workspace"]))
    before = {str(path.relative_to(source)): (path.read_bytes(), stat.S_IMODE(path.stat().st_mode), path.stat().st_mtime_ns)
              for path in source.rglob("*") if path.is_file()}
    result = invoke(str(context["orbit_os_executable"]), "status", "--workspace", str(source), "--json")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["personal"]["status"] == "error"
    assert any(issue["code"] == "personal_unreadable" for issue in payload["issues"])
    watch = payload["watchlist"][0]
    assert watch["username"] == "atlas_studio" and watch["status"] == "failed"
    assert watch["pending_removals"] == 1 and watch["events"] == []
    after = {str(path.relative_to(source)): (path.read_bytes(), stat.S_IMODE(path.stat().st_mode), path.stat().st_mtime_ns)
             for path in source.rglob("*") if path.is_file()}
    assert before == after
    assessment = json.loads((output / "assessment.json").read_text())
    run = str(Path(str(context["output_directory"])).parent)
    recorded = assessment["source_metadata"][run]
    assert recorded["personal-corrupt-public-failed/personal/snapshots.json"]["mtime_ns"] == before["personal/snapshots.json"][2]
    assert recorded["personal-corrupt-public-failed"]["kind"] == "directory"
