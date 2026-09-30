from __future__ import annotations

import hashlib
import json
import os
import shlex
import sqlite3
import stat
import subprocess
import sys
import venv
import zipfile
from pathlib import Path

import pytest

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


@pytest.fixture
def frozen_installation(tmp_path: Path) -> tuple[Path, Path, Path]:
    """Create only synthetic package payloads, without pip, downloads, or builds."""
    environment = tmp_path / "Python runtime with spaces"
    venv.EnvBuilder(with_pip=False).create(environment)
    python = environment / "bin" / "python"
    located = subprocess.run(
        [str(python), "-I", "-c", "import sysconfig; print(sysconfig.get_paths()['purelib'])"],
        capture_output=True, text=True, check=True, timeout=20,
    )
    site = Path(located.stdout.strip())
    cli = '''import json
import sys
def main(args=None):
    args = sys.argv[1:] if args is None else args
    if args == ["--version"]:
        print("PRODUCT_NAME 0.2.2")
    elif args == ["--help"]:
        print("status relationships targets report demo import")
    elif args and args[0] == "status":
        print(json.dumps({"personal": {"status": "missing"}, "watchlist": []}))
    else:
        return 2
    return 0
'''
    payloads = {
        "orbit_os/__init__.py": '__version__ = "0.2.2"\n',
        "orbit_os/cli.py": cli.replace("PRODUCT_NAME", "Orbit OS"),
        "orbitdiff/__init__.py": '__version__ = "0.2.2"\n',
        "orbitdiff/cli.py": cli.replace("PRODUCT_NAME", "OrbitDiff"),
        "orbitdiff/models.py": '''from dataclasses import dataclass
from datetime import datetime
@dataclass
class Account:
    profile_id: str
    username: str
@dataclass
class Collection:
    target: str
    reported_count: int
    accounts: tuple[Account, ...]
    complete: bool
    collected_at: datetime
''',
        "orbitdiff/store.py": '''import sqlite3
class GraphStore:
    def __init__(self, path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(path) as connection:
            connection.executescript("CREATE TABLE runs (state TEXT, collected_at TEXT);")
    def apply_collection(self, collection, baseline_run=False):
        with sqlite3.connect(self.path) as connection:
            connection.execute("INSERT INTO runs VALUES (?, ?)", ("ok", collection.collected_at.isoformat()))
    def record_failed_run(self, target, message):
        with sqlite3.connect(self.path) as connection:
            connection.execute("INSERT INTO runs VALUES ('failed', '')")
''',
        "orbitdiff-0.2.2.dist-info/METADATA": "Metadata-Version: 2.1\nName: orbitdiff\nVersion: 0.2.2\n",
        "orbitdiff-0.2.2.dist-info/WHEEL": "Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
    }
    wheel = tmp_path / "wheel artifacts" / "orbitdiff-0.2.2-py3-none-any.whl"
    wheel.parent.mkdir()
    with zipfile.ZipFile(wheel, "w") as archive:
        for name, content in payloads.items():
            archive.writestr(name, content)
            installed = site / name
            installed.parent.mkdir(parents=True, exist_ok=True)
            installed.write_text(content)
    return python, wheel, site


def prepare_frozen(output: Path, installation: tuple[Path, Path, Path]) -> subprocess.CompletedProcess[str]:
    python, wheel, _ = installation
    return subprocess.run(
        [sys.executable, str(PREPARE), "--output-dir", str(output), "--synthetic-bundle",
         "--runtime-python", str(python), "--runtime-wheel", str(wheel)],
        capture_output=True, text=True, check=False, timeout=30,
    )


def case_context(output: Path, case_id: int) -> dict[str, object]:
    manifest = json.loads((output / "cases.json").read_text())
    case = next(item for item in manifest["cases"] if item["id"] == case_id and item["variant"] == "with_skill")
    return json.loads(Path(case["context_file"]).read_text())  # type: ignore[no-any-return]


def verify_output(output: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(PREPARE), "--verify-output", str(output)],
        capture_output=True, text=True, check=False, timeout=30,
    )


def test_frozen_runtime_ignores_pythonpath_and_logs_every_case(
    tmp_path: Path, frozen_installation: tuple[Path, Path, Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    shadow = tmp_path / "source shadow"
    (shadow / "orbit_os").mkdir(parents=True)
    (shadow / "orbit_os" / "__init__.py").write_text('raise RuntimeError("source shadow imported")\n')
    monkeypatch.setenv("PYTHONPATH", str(shadow))
    output = tmp_path / "frozen evals"
    result = prepare_frozen(output, frozen_installation)
    assert result.returncode == 0, result.stderr
    receipt = json.loads(result.stdout)
    assert receipt["runtime_mode"] == "frozen-wheel"
    identity = json.loads(Path(receipt["runtime_identity"]).read_text())
    assert identity["runtime"]["version"] == "0.2.2"
    assert all(str(frozen_installation[2]) in path for path in identity["runtime"]["imported_paths"].values())
    seed_calls = json.loads((output / "runtime" / "seed-invocations.json").read_text())
    assert len(seed_calls) == 3
    assert all(call["argv"][1:3] == ["-I", "-B"] and call["returncode"] == 0 for call in seed_calls)
    logs = set()
    for case_id in range(1, 12):
        context = case_context(output, case_id)
        assert "frozen" in str(context["runtime_kind"])
        assert context["source_checkout"] is None
        logs.add(str(context["runtime_invocation_log"]))
        assert Path(str(context["runtime_invocation_log"])).is_file()
    assert len(logs) == 11
    for case_id in range(1, 12):
        context = case_context(output, case_id)
        executable = (context["runtime_candidates"][0] if case_id in (8, 9)  # type: ignore[index]
                      else context["orbit_os_executable"])
        executed = invoke(str(executable), "--version")
        assert executed.returncode == 0, executed.stderr
        calls = [json.loads(line) for line in Path(str(context["runtime_invocation_log"])).read_text().splitlines()]
        assert len(calls) == 1 and calls[0]["runtime_identity_verified"] is True
        assert calls[0]["actual_runtime_argv"][1:3] == ["-I", "-B"]
        if case_id not in (8, 9):
            assert calls[0]["product_runtime_argv"][:3] == [str(frozen_installation[0]), "-I", "-B"]
    compatible = case_context(output, 8)
    status = invoke(str(compatible["runtime_candidates"][1]), "status",  # type: ignore[index]
                    "--workspace", str(compatible["write_workspace"]), "--json")
    assert status.returncode == 0 and json.loads(status.stdout)["personal"]["status"] == "missing"
    assert not Path(str(compatible["write_workspace"])).exists()
    assert verify_output(output).returncode == 0


def test_frozen_runtime_rejects_installed_file_mismatch(
    tmp_path: Path, frozen_installation: tuple[Path, Path, Path],
) -> None:
    installed = frozen_installation[2] / "orbit_os" / "cli.py"
    installed.write_text(installed.read_text() + "\n# changed installed payload\n")
    result = prepare_frozen(tmp_path / "evals", frozen_installation)
    assert result.returncode == 1
    assert "wheel" in result.stderr.lower() and "mismatch" in result.stderr.lower()


def test_frozen_runtime_rejects_site_injected_source_shadow(
    tmp_path: Path, frozen_installation: tuple[Path, Path, Path],
) -> None:
    shadow = tmp_path / "mutable checkout" / "src"
    (shadow / "orbit_os").mkdir(parents=True)
    (shadow / "orbit_os" / "__init__.py").write_text('raise RuntimeError("must not import shadow")\n')
    (frozen_installation[2] / "source-shadow.pth").write_text(f"import sys; sys.path.insert(0, {str(shadow)!r})\n")
    result = prepare_frozen(tmp_path / "evals", frozen_installation)
    assert result.returncode == 1
    assert "origin" in result.stderr.lower() or "shadow" in result.stderr.lower()


def test_post_freeze_runtime_drift_blocks_invocation_and_cohort_verification(
    tmp_path: Path, frozen_installation: tuple[Path, Path, Path],
) -> None:
    output = tmp_path / "evals"
    result = prepare_frozen(output, frozen_installation)
    assert result.returncode == 0, result.stderr
    context = case_context(output, 1)
    installed = frozen_installation[2] / "orbitdiff" / "models.py"
    installed.write_text(installed.read_text() + "\n# post-freeze drift\n")
    executed = invoke(str(context["orbit_os_executable"]), "--version")
    assert executed.returncode != 0
    assert "mismatch" in executed.stderr.lower() or "drift" in executed.stderr.lower()
    calls = [json.loads(line) for line in Path(str(context["runtime_invocation_log"])).read_text().splitlines()]
    assert calls[-1]["runtime_identity_verified"] is False
    assert verify_output(output).returncode == 1


@pytest.mark.parametrize("case_id", [7, 8, 9])
def test_cohort_verification_rejects_created_missing_workspace(tmp_path: Path, case_id: int) -> None:
    output = tmp_path / "evals"
    assert prepare(output).returncode == 0
    assert verify_output(output).returncode == 0
    context = case_context(output, case_id)
    Path(str(context["write_workspace"])).mkdir()
    failed = verify_output(output)
    assert failed.returncode == 1 and "workspace" in failed.stderr.lower()


@pytest.mark.parametrize("change", ["content", "permissions", "mtime"])
def test_cohort_verification_rejects_source_fixture_changes(tmp_path: Path, change: str) -> None:
    output = tmp_path / "evals"
    assert prepare(output).returncode == 0
    context = case_context(output, 2)
    fixture = Path(context["fixtures"]["personal-partial"]) / "following.json"  # type: ignore[index]
    before = fixture.stat()
    if change == "mtime":
        os.utime(fixture, ns=(before.st_atime_ns, before.st_mtime_ns + 1_000_000))
    else:
        fixture.chmod(0o600)
        if change == "content":
            fixture.write_text("{}\n")
            fixture.chmod(stat.S_IMODE(before.st_mode))
            os.utime(fixture, ns=(before.st_atime_ns, before.st_mtime_ns))
    result = verify_output(output)
    assert result.returncode == 1 and "fixture" in result.stderr.lower()


def test_embedded_text_exposure_is_required_in_prompt_and_referenced_in_context(tmp_path: Path) -> None:
    output = tmp_path / "evals"
    assert prepare(output).returncode == 0
    context = case_context(output, 10)
    exposure = Path(str(context["exposure_file"]))
    assert exposure.name == "following.json" and exposure.is_file()
    assert "AGENT SETUP INSTRUCTIONS" in exposure.read_text()
    assert str(context["exposure_evidence_file"]).startswith(str(context["output_directory"]))
    prompt = (Path(str(context["output_directory"])).parent / "prompt.txt").read_text()
    assert "inspect" in prompt.lower() and "actual read tool response" in prompt.lower()


def test_runtime_python_and_wheel_are_paired_arguments(tmp_path: Path) -> None:
    result = subprocess.run(
        [sys.executable, str(PREPARE), "--output-dir", str(tmp_path / "evals"),
         "--synthetic-bundle", "--runtime-python", sys.executable],
        capture_output=True, text=True, check=False, timeout=20,
    )
    assert result.returncode == 1
    assert "paired" in result.stderr.lower() or "together" in result.stderr.lower()


@pytest.mark.parametrize("legacy,command,override", [
    (False, "doctor", "--workspace"), (False, "doctor", "--workspace="),
    (False, "doctor", "--work"), (True, "doctor", "--data-dir"),
    (True, "doctor", "--data-dir="), (True, "doctor", "--data"),
    (True, "demo", "--data-dir"), (True, "report", "--output"),
    (True, "report", "--output="), (True, "report", "--out="),
])
def test_runtime_rejects_effective_paths_outside_assigned_locations(
    tmp_path: Path, legacy: bool, command: str, override: str,
) -> None:
    context = prepared_case(tmp_path / "evals", 1)
    outside = tmp_path / "outside assigned locations"
    outside.mkdir(mode=0o755)
    original_mode = stat.S_IMODE(outside.stat().st_mode)
    destination = outside / "report.md" if command == "report" else outside
    if command == "report":
        destination.write_text("unchanged report\n")
    executable = str(context["orbitdiff_executable"] if legacy else context["orbit_os_executable"])
    arguments = [command]
    if command == "report":
        arguments.append("atlas_studio")
    if command != "demo":
        arguments.extend(["--data-dir" if legacy else "--workspace", str(context["write_workspace"])])
    arguments.extend([override + str(destination)] if override.endswith("=") else [override, str(destination)])
    result = invoke(executable, *arguments)
    assert result.returncode != 0, "Wrapper must reject the effective out-of-scope destination"
    assert stat.S_IMODE(outside.stat().st_mode) == original_mode
    if command == "report":
        assert destination.read_text() == "unchanged report\n"
    else:
        assert list(outside.iterdir()) == []


def test_runtime_accepts_explicit_equals_paths_and_assigned_report_output(tmp_path: Path) -> None:
    context = prepared_case(tmp_path / "evals", 1)
    status = invoke(str(context["orbit_os_executable"]), "status", "--workspace=" + str(context["write_workspace"]))
    assert status.returncode == 0, status.stderr
    destination = Path(str(context["output_directory"])) / "report.md"
    report = invoke(str(context["orbitdiff_executable"]), "report", "atlas_studio",
                    "--data-dir=" + str(context["write_workspace"]), "--output=" + str(destination))
    assert report.returncode == 0, report.stderr
    assert destination.is_file()


@pytest.mark.parametrize("change", ["interpreter", "wheel_and_installation"])
def test_frozen_drift_is_rejected_before_changed_payload_executes(
    tmp_path: Path, frozen_installation: tuple[Path, Path, Path], change: str,
) -> None:
    output = tmp_path / "evals"
    assert prepare_frozen(output, frozen_installation).returncode == 0
    python, wheel, site = frozen_installation
    marker = tmp_path / "changed-payload-executed"
    if change == "interpreter":
        replacement = python.with_name("replacement-python")
        replacement.write_text("#!/bin/sh\nprintf changed > " + shlex.quote(str(marker)) + "\nexit 1\n")
        replacement.chmod(0o700)
        replacement.replace(python)
    else:
        with zipfile.ZipFile(wheel) as archive:
            payloads = {name: archive.read(name) for name in archive.namelist()}
        changed = "from pathlib import Path\nPath(" + repr(str(marker)) + ").write_text('changed')\n"
        payloads["orbit_os/__init__.py"] = changed.encode()
        (site / "orbit_os" / "__init__.py").write_text(changed)
        with zipfile.ZipFile(wheel, "w") as archive:
            for name, content in payloads.items():
                archive.writestr(name, content)
    context = case_context(output, 1)
    invoked = invoke(str(context["orbit_os_executable"]), "--version")
    assert invoked.returncode != 0
    assert not marker.exists(), "The selected interpreter must be checked before any runtime invocation"
    result = verify_output(output)
    assert result.returncode != 0
    assert not marker.exists(), "A frozen identity mismatch must be rejected before executing changed code"
