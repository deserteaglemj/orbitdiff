from __future__ import annotations

import importlib.util
import sys
import zipfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "scripts" / "check_published_skill.py"


def checker():
    assert SCRIPT.is_file(), "Published verification must be repeatable independently of candidate CI"
    spec = importlib.util.spec_from_file_location("published_skill_check", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(SCRIPT.parent))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.pop(0)
    return module


def test_checksum_mismatch_and_duplicate_entries_are_rejected(tmp_path: Path) -> None:
    check = checker()
    artifact = tmp_path / "example.zip"
    artifact.write_bytes(b"abc")
    digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    assert check.verify_checksums(f"{digest}  example.zip\n", [artifact]) == {
        "example.zip": digest
    }
    with pytest.raises(ValueError, match="duplicate"):
        check.verify_checksums(f"{digest}  example.zip\n{digest}  example.zip\n", [artifact])
    artifact.write_bytes(b"changed")
    with pytest.raises(ValueError, match="checksum"):
        check.verify_checksums(f"{digest}  example.zip\n", [artifact])


def test_missing_or_unsafe_checksum_entry_is_rejected(tmp_path: Path) -> None:
    check = checker()
    artifact = tmp_path / "example.zip"
    artifact.write_bytes(b"abc")
    with pytest.raises(ValueError, match="missing"):
        check.verify_checksums("", [artifact])
    with pytest.raises(ValueError, match="filename"):
        check.verify_checksums("a" * 64 + "  ../example.zip\n", [artifact])


def skill_text(*, installed: bool = False, body: str = "Read the evidence.\n") -> str:
    if installed:
        return (
            "---\nlicense: MIT\nmetadata:\n"
            "    github-path: skills/orbitdiff\n"
            "    github-ref: refs/tags/v0.2.2\n"
            "    github-repo: https://github.com/example/orbitdiff\n"
            "    github-tree-sha: " + "b" * 40 + "\n"
            "    version: 0.2.2\nname: orbitdiff\n---\n" + body
        )
    return '---\nname: orbitdiff\nlicense: MIT\nmetadata:\n  version: "0.2.2"\n---\n\n' + body


def test_installer_normalization_is_explicit_and_body_changes_fail() -> None:
    check = checker()
    expected = {
        "github-path": "skills/orbitdiff",
        "github-ref": "refs/tags/v0.2.2",
        "github-repo": "https://github.com/example/orbitdiff",
        "github-tree-sha": "b" * 40,
    }
    receipt = check.compare_skill_document(skill_text(), skill_text(installed=True), expected)
    assert receipt["added_metadata"] == expected
    assert receipt["leading_body_newline_removed"] is True
    with pytest.raises(ValueError, match="body"):
        check.compare_skill_document(
            skill_text(), skill_text(installed=True, body="Changed instruction.\n"), expected
        )
    with pytest.raises(ValueError, match="metadata"):
        check.compare_skill_document(
            skill_text(), skill_text(installed=True).replace("version: 0.2.2", "version: 9.0.0"), expected
        )


def test_extra_installer_metadata_and_ambiguous_yaml_are_rejected() -> None:
    check = checker()
    expected = {
        "github-path": "skills/orbitdiff",
        "github-ref": "refs/tags/v0.2.2",
        "github-repo": "https://github.com/example/orbitdiff",
        "github-tree-sha": "b" * 40,
    }
    with pytest.raises(ValueError, match="metadata"):
        check.compare_skill_document(
            skill_text(), skill_text(installed=True).replace("    version:", "    extra: ignored\n    version:"), expected
        )
    with pytest.raises(ValueError, match="duplicate"):
        check.compare_skill_document(
            skill_text(), skill_text(installed=True).replace("name: orbitdiff", "name: orbitdiff\nname: other"), expected
        )


def test_inconsistent_metadata_indentation_is_not_treated_as_normalization() -> None:
    check = checker()
    expected = {
        "github-path": "skills/orbitdiff",
        "github-ref": "refs/tags/v0.2.2",
        "github-repo": "https://github.com/example/orbitdiff",
        "github-tree-sha": "b" * 40,
    }
    with pytest.raises(ValueError, match="indentation"):
        check.compare_skill_document(
            skill_text(), skill_text(installed=True).replace("    version:", "  version:"), expected
        )


def test_observed_installer_pin_is_preserved_and_wrong_pin_is_rejected() -> None:
    check = checker()
    expected = {
        "github-path": "skills/orbitdiff",
        "github-ref": "refs/tags/v0.2.2",
        "github-repo": "https://github.com/example/orbitdiff",
        "github-tree-sha": "b" * 40,
        "github-pinned": "v0.2.2",
    }
    installed = skill_text(installed=True).replace(
        "    github-path:", "    github-pinned: v0.2.2\n    github-path:"
    )
    assert check.compare_skill_document(skill_text(), installed, expected)["added_metadata"] == expected
    with pytest.raises(ValueError, match="metadata"):
        check.compare_skill_document(skill_text(), installed.replace("github-pinned: v0.2.2", "github-pinned: v0.1.1"), expected)


def test_published_wheel_product_bytes_must_match_pinned_source(tmp_path: Path) -> None:
    check = checker()
    assert hasattr(check, "verify_wheel_tree"), "A release label must not stand in for wheel source identity"
    wheel = tmp_path / "example.whl"
    with zipfile.ZipFile(wheel, "w") as archive:
        archive.writestr("orbit_os/__init__.py", b"hello\n")
        archive.writestr("example.dist-info/METADATA", b"Version: 0.2.2\n")
    tree = [{"path": "src/orbit_os/__init__.py", "type": "blob", "mode": "100644", "sha": "ce013625030ba8dba906f756967f9e9ca394464a"}]
    assert check.verify_wheel_tree(wheel, tree) == 1
    tree[0]["sha"] = "a" * 40
    with pytest.raises(ValueError, match="tree"):
        check.verify_wheel_tree(wheel, tree)


@pytest.mark.parametrize("linked_component", ["installed", "orbitdiff"])
def test_installer_cannot_substitute_symlinked_roots(tmp_path: Path, linked_component: str) -> None:
    check = checker()
    assert hasattr(check, "installed_files"), "The installation root must be checked before reading descendants"
    external = tmp_path / "external"
    external.mkdir()
    (external / "SKILL.md").write_text("unchanged")
    output = tmp_path / "proof"
    output.mkdir()
    if linked_component == "installed":
        (output / "installed").symlink_to(external, target_is_directory=True)
    else:
        (output / "installed").mkdir()
        (output / "installed" / "orbitdiff").symlink_to(external, target_is_directory=True)
    with pytest.raises(ValueError, match="symbolic|symlink"):
        check.installed_files(output)
    assert (external / "SKILL.md").read_text() == "unchanged"


def test_git_blob_identity_detects_archive_content_drift() -> None:
    check = checker()
    assert check.git_blob_sha(b"hello\n") == "ce013625030ba8dba906f756967f9e9ca394464a"
    tree = [{"path": "SKILL.md", "type": "blob", "mode": "100644", "sha": "ce013625030ba8dba906f756967f9e9ca394464a"}]
    check.verify_tree({"SKILL.md": b"hello\n"}, tree)
    with pytest.raises(ValueError, match="tree"):
        check.verify_tree({"SKILL.md": b"other\n"}, tree)
    with pytest.raises(ValueError, match="tree"):
        check.verify_tree({"SKILL.md": b"hello\n", "unlisted.md": b"extra"}, tree)


def test_existing_output_is_preserved_and_invalid_pin_never_starts_download(tmp_path: Path) -> None:
    check = checker()
    destination = tmp_path / "existing"
    destination.mkdir()
    marker = destination / "retain.txt"
    marker.write_text("unchanged")
    with pytest.raises(FileExistsError):
        check.run_check("example/orbitdiff", "v0.2.2", "a" * 40, destination)
    with pytest.raises(ValueError, match="expected commit"):
        check.run_check("example/orbitdiff", "latest", "a" * 40, tmp_path / "unused")
    assert marker.read_text() == "unchanged"
    assert not (tmp_path / "unused").exists()


def test_external_command_failure_retains_an_error_receipt(tmp_path: Path, monkeypatch) -> None:
    check = checker()

    def unavailable(*args, **kwargs):
        raise OSError("GitHub CLI unavailable")

    monkeypatch.setattr(check.subprocess, "run", unavailable)
    result = check.run_check("example/orbitdiff", "v0.2.2", "a" * 40, tmp_path / "proof")
    assert result["outcome"] == "error"
    assert result["error"] == "GitHub CLI unavailable"
    assert (tmp_path / "proof" / "published-receipt.json").is_file()
