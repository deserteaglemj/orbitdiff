from __future__ import annotations

import hashlib
import json
import shutil
import stat
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
BUILDER = ROOT / "scripts" / "build_skill.py"


def source_tree(tmp_path: Path) -> Path:
    source = tmp_path / "source"
    source.mkdir()
    shutil.copytree(ROOT / "skills" / "orbitdiff", source / "skills" / "orbitdiff")
    shutil.copyfile(ROOT / "LICENSE", source / "LICENSE")
    shutil.copyfile(ROOT / "pyproject.toml", source / "pyproject.toml")
    return source


def build(source: Path, output: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(BUILDER), "--source-root", str(source), "--output-dir", str(output)],
        check=False, capture_output=True, text=True, timeout=15,
    )


def test_skill_archive_is_deterministic_complete_and_passes_existing_audit(tmp_path: Path) -> None:
    source = source_tree(tmp_path)
    first = build(source, tmp_path / "first")
    second = build(source, tmp_path / "second")
    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    receipt = json.loads(first.stdout)
    archive = Path(receipt["archive"])
    other = Path(json.loads(second.stdout)["archive"])
    assert archive.read_bytes() == other.read_bytes()
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    assert receipt["sha256"] == digest
    assert Path(receipt["sha256_file"]).read_text() == f"{digest}  {archive.name}\n"
    with zipfile.ZipFile(archive) as packaged:
        names = packaged.namelist()
        assert len(names) == len(set(names))
        assert "orbitdiff/SKILL.md" in names
        assert "orbitdiff/LICENSE" in names
        assert "orbitdiff/references/personal-exports.md" in names
        assert "orbitdiff/references/commands.md" in names
        assert packaged.read("orbitdiff/LICENSE") == (ROOT / "LICENSE").read_bytes()
        for member in packaged.infolist():
            assert member.filename.startswith("orbitdiff/")
            assert ".." not in Path(member.filename).parts
            assert member.date_time == (1980, 1, 1, 0, 0, 0)
            assert stat.S_IFMT(member.external_attr >> 16) == stat.S_IFREG
    audit = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "package_audit.py"), str(archive)],
        capture_output=True, text=True, check=False, timeout=15,
    )
    assert audit.returncode == 0, audit.stdout


@pytest.mark.parametrize("extra_name", ["graph.db", "notes.txt", "state.sqlite3-wal"])
def test_unlisted_or_private_files_fail_before_artifact_creation(tmp_path: Path, extra_name: str) -> None:
    source = source_tree(tmp_path)
    (source / "skills" / "orbitdiff" / extra_name).write_text("synthetic local data")
    output = tmp_path / "output"
    result = build(source, output)
    assert result.returncode == 1
    assert "not allowed" in result.stderr.lower()
    assert not output.exists() or list(output.iterdir()) == []


def test_symlinked_allowlisted_file_and_linked_output_are_rejected(tmp_path: Path) -> None:
    source = source_tree(tmp_path)
    skill = source / "skills" / "orbitdiff" / "SKILL.md"
    outside = tmp_path / "outside.md"
    skill.rename(outside)
    skill.symlink_to(outside)
    result = build(source, tmp_path / "output")
    assert result.returncode == 1
    assert "symbolic" in result.stderr.lower()
    skill.unlink()
    outside.rename(skill)
    real_output = tmp_path / "real-output"
    real_output.mkdir()
    linked_output = tmp_path / "linked-output"
    linked_output.symlink_to(real_output, target_is_directory=True)
    result = build(source, linked_output)
    assert result.returncode == 1
    assert list(real_output.iterdir()) == []


def test_public_source_validation_prevents_private_paths_in_archive(tmp_path: Path) -> None:
    source = source_tree(tmp_path)
    reference = source / "skills" / "orbitdiff" / "references" / "safety.md"
    reference.write_text(reference.read_text() + "\n/" + "Users/example/private.txt\n")
    result = build(source, tmp_path / "output")
    assert result.returncode == 1
    assert "public-safety" in result.stderr.lower()


def test_version_mismatch_fails_without_publishing_archive(tmp_path: Path) -> None:
    source = source_tree(tmp_path)
    project = source / "pyproject.toml"
    project.write_text(project.read_text().replace('version = "0.2.0"', 'version = "9.9.9"'))
    result = build(source, tmp_path / "output")
    assert result.returncode == 1
    assert "version" in result.stderr.lower()
