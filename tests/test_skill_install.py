from __future__ import annotations

import hashlib
import importlib.util
import json
import stat
import subprocess
import sys
import zipfile
from pathlib import Path
from types import ModuleType

import pytest
from test_prepare_skill_evals import frozen_installation as frozen_installation

ROOT = Path(__file__).parents[1]
CHECKER = ROOT / "scripts" / "check_skill_install.py"


def checker() -> ModuleType:
    assert CHECKER.is_file(), "The installed-artifact checker has not been implemented"
    sys.path.insert(0, str(ROOT / "scripts"))
    spec = importlib.util.spec_from_file_location("check_skill_install", CHECKER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def skill_archive(tmp_path: Path) -> Path:
    completed = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "build_skill.py"), "--output-dir", str(tmp_path / "artifacts")],
        capture_output=True, text=True, timeout=20, check=True,
    )
    return Path(json.loads(completed.stdout)["archive"])


def changed_archive(archive: Path, change: str) -> Path:
    with zipfile.ZipFile(archive) as source:
        entries = {name: source.read(name) for name in source.namelist()}
    if change == "missing_asset":
        del entries["orbitdiff/assets/orbitdiff-mark.svg"]
    elif change == "broken_reference":
        entries["orbitdiff/references/commands.md"] += b"\n[Missing](missing.md)\n"
    elif change == "metadata_escape":
        entries["orbitdiff/agents/openai.yaml"] = entries["orbitdiff/agents/openai.yaml"].replace(
            b"./assets/orbitdiff-mark.svg", b"../outside.svg",
        )
    elif change == "unsafe_path":
        entries["../outside.txt"] = b"outside"
    result = archive.with_name("modified-skill.zip")
    with zipfile.ZipFile(result, "w") as target:
        for name, content in entries.items():
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            target.writestr(info, content)
        if change == "symlink":
            info = zipfile.ZipInfo("orbitdiff/linked")
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            target.writestr(info, "../outside")
    return result


def test_complete_skill_extraction_validates_references_assets_metadata_and_version(
    tmp_path: Path, skill_archive: Path,
) -> None:
    before = (hashlib.sha256(skill_archive.read_bytes()).hexdigest(), skill_archive.stat().st_mtime_ns)
    destination = tmp_path / "installed skill"
    receipt = checker().validate_skill_archive(skill_archive, destination, "0.2.2")
    assert receipt["version"] == "0.2.2" and receipt["compatibility_verified"] is True
    with zipfile.ZipFile(skill_archive) as archive:
        assert {str(path.relative_to(destination)) for path in destination.rglob("*") if path.is_file()} == set(archive.namelist())
        for name in archive.namelist():
            assert (destination / name).read_bytes() == archive.read(name)
    assert before == (hashlib.sha256(skill_archive.read_bytes()).hexdigest(), skill_archive.stat().st_mtime_ns)


@pytest.mark.parametrize("change", ["missing_asset", "broken_reference", "metadata_escape", "unsafe_path", "symlink"])
def test_invalid_skill_archive_is_rejected_before_any_extraction(
    tmp_path: Path, skill_archive: Path, change: str,
) -> None:
    destination = tmp_path / "installed skill"
    module = checker()
    with pytest.raises(ValueError):
        module.validate_skill_archive(changed_archive(skill_archive, change), destination, "0.2.2")
    assert not destination.exists()


def test_wrong_skill_version_is_rejected(tmp_path: Path, skill_archive: Path) -> None:
    module = checker()
    with pytest.raises(ValueError, match="version"):
        module.validate_skill_archive(skill_archive, tmp_path / "skill", "9.9.9")


def test_wrong_candidate_version_returns_error_receipt_before_installation(
    tmp_path: Path, skill_archive: Path, frozen_installation: tuple[Path, Path, Path],
) -> None:
    module = checker()
    output = tmp_path / "check output"
    result = module.check_install(
        frozen_installation[1], skill_archive, "1" * 40,
        output_dir=output, expected_version="9.9.9", provenance="candidate",
    )
    assert result["outcome"] == "error" and result["phase"] == "artifacts"
    assert result["commands"] == [] and not (output / "venv").exists()
    recorded = json.loads((output / "install-receipt.json").read_text())
    assert recorded["outcome"] == "error"
    assert str(tmp_path) not in json.dumps(recorded)


def test_existing_output_is_preserved_and_output_under_checkout_is_rejected(
    tmp_path: Path, skill_archive: Path, frozen_installation: tuple[Path, Path, Path],
) -> None:
    module = checker()
    existing = tmp_path / "existing"
    existing.mkdir()
    marker = existing / "preserve.txt"
    marker.write_text("preserved")
    result = module.check_install(frozen_installation[1], skill_archive, "1" * 40, output_dir=existing)
    assert result["outcome"] == "error" and marker.read_text() == "preserved"
    assert not (existing / "install-receipt.json").exists()
    inside = ROOT / "must-not-create-install-check"
    result = module.check_install(frozen_installation[1], skill_archive, "1" * 40, output_dir=inside)
    assert result["outcome"] == "error" and not inside.exists()


def test_installed_product_file_mismatch_is_rejected(
    tmp_path: Path, frozen_installation: tuple[Path, Path, Path],
) -> None:
    module = checker()
    python, wheel, site = frozen_installation
    (site / "orbit_os" / "cli.py").write_text("raise RuntimeError('unverified file')\n")
    with pytest.raises(ValueError, match="mismatch"):
        module.verify_runtime(python, wheel, tmp_path)


def test_installed_module_source_shadow_is_rejected_without_importing_it(
    tmp_path: Path, frozen_installation: tuple[Path, Path, Path],
) -> None:
    module = checker()
    python, wheel, site = frozen_installation
    source = tmp_path / "source shadow"
    (source / "orbit_os").mkdir(parents=True)
    marker = tmp_path / "shadow-imported"
    (source / "orbit_os" / "__init__.py").write_text(f"from pathlib import Path\nPath({str(marker)!r}).touch()\n")
    (site / "shadow.pth").write_text(f"import sys; sys.path.insert(0, {str(source)!r})\n")
    with pytest.raises(ValueError, match="origin|shadow"):
        module.verify_runtime(python, wheel, tmp_path)
    assert not marker.exists()


def test_runtime_ignores_host_pythonpath_and_reports_actual_installed_origins(
    tmp_path: Path, frozen_installation: tuple[Path, Path, Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = checker()
    python, wheel, site = frozen_installation
    source = tmp_path / "host source"
    (source / "orbit_os").mkdir(parents=True)
    (source / "orbit_os" / "__init__.py").write_text("raise RuntimeError('host Python path imported')\n")
    monkeypatch.setenv("PYTHONPATH", str(source))
    identity = module.verify_runtime(python, wheel, tmp_path)
    assert identity["version"] == "0.2.2"
    assert all(Path(origin).is_relative_to(site) for origin in identity["imported_paths"].values())
    assert len(identity["files"]) == 6


def test_unlaunchable_command_keeps_actual_attempt_in_error_receipt(tmp_path: Path) -> None:
    module = checker()
    commands = []
    missing = str(tmp_path / "missing executable")
    with pytest.raises(ValueError, match="start"):
        module._run([missing, "--version"], tmp_path, commands)
    assert len(commands) == 1
    assert commands[0]["argv"] == [missing, "--version"]
    assert commands[0]["returncode"] is None and commands[0]["stderr"]
