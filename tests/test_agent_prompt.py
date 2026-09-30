from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import tomllib
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
PROMPT = ROOT / "docs" / "prompt.md"
ONBOARDING = ROOT / "skills" / "orbitdiff" / "references" / "onboarding.md"
INSTALLATION = ONBOARDING.with_name("installation.md")


def _archive_recipe() -> str:
    match = re.search(
        r"python3 - DOWNLOAD_DIR SKILL_PARENT <<'PY'\n(.*?)\nPY",
        INSTALLATION.read_text(), re.DOTALL,
    )
    assert match is not None, "The archive route needs an executable verification recipe"
    return match.group(1)


def _release_inputs(directory: Path, *, unsafe: bool = False) -> None:
    directory.mkdir()
    wheel = directory / "orbitdiff-0.2.2-py3-none-any.whl"
    wheel.write_bytes(b"synthetic wheel bytes, never installed")
    archive = directory / "orbitdiff-skill-0.2.2.zip"
    with zipfile.ZipFile(archive, "w") as package:
        package.writestr("orbitdiff/SKILL.md", "synthetic skill")
        package.writestr("orbitdiff/references/example.md", "synthetic reference")
        if unsafe:
            package.writestr("orbitdiff/../../escaped.md", "outside destination")
    (directory / "SHA256SUMS.txt").write_text("".join(
        f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
        for path in (wheel, archive)
    ))


def test_documented_archive_recipe_preserves_complete_skill(tmp_path: Path) -> None:
    downloads = tmp_path / "release downloads"
    parent = tmp_path / "selected project" / ".agents" / "skills"
    _release_inputs(downloads)
    result = subprocess.run(
        [sys.executable, "-", str(downloads), str(parent)], input=_archive_recipe(),
        capture_output=True, text=True, check=False, timeout=15,
    )
    assert result.returncode == 0, result.stderr
    assert (parent / "orbitdiff" / "SKILL.md").read_text() == "synthetic skill"
    assert (parent / "orbitdiff" / "references" / "example.md").read_text() == "synthetic reference"
    assert "Verified" in result.stdout


@pytest.mark.parametrize("requested", ["skill", "runtime"])
def test_documented_archive_recipe_accepts_only_the_requested_piece(
    tmp_path: Path, requested: str,
) -> None:
    downloads = tmp_path / "release downloads"
    parent = tmp_path / "selected project" / ".agents" / "skills"
    _release_inputs(downloads)
    omitted = (
        "orbitdiff-0.2.2-py3-none-any.whl" if requested == "skill"
        else "orbitdiff-skill-0.2.2.zip"
    )
    (downloads / omitted).unlink()
    destination_argument = str(parent) if requested == "skill" else "-"
    result = subprocess.run(
        [sys.executable, "-", str(downloads), destination_argument], input=_archive_recipe(),
        cwd=tmp_path, capture_output=True, text=True, check=False, timeout=15,
    )
    assert result.returncode == 0, result.stderr
    assert "Verified" in result.stdout
    if requested == "skill":
        assert (parent / "orbitdiff" / "SKILL.md").read_text() == "synthetic skill"
    else:
        assert not parent.exists()
        assert not (tmp_path / "-").exists()


@pytest.mark.parametrize("problem", ["checksum", "existing", "unsafe-member"])
def test_documented_archive_recipe_stops_before_extracting_invalid_inputs(
    tmp_path: Path, problem: str,
) -> None:
    downloads = tmp_path / "release downloads"
    parent = tmp_path / "selected project" / ".agents" / "skills"
    destination = parent / "orbitdiff"
    _release_inputs(downloads, unsafe=problem == "unsafe-member")
    if problem == "checksum":
        (downloads / "orbitdiff-0.2.2-py3-none-any.whl").write_bytes(b"modified after checksum")
    if problem == "existing":
        destination.mkdir(parents=True)
        (destination / "keep.md").write_text("existing skill")
    result = subprocess.run(
        [sys.executable, "-", str(downloads), str(parent)], input=_archive_recipe(),
        capture_output=True, text=True, check=False, timeout=15,
    )
    assert result.returncode != 0
    assert not (destination / "SKILL.md").exists()
    assert not (parent.parent / "escaped.md").exists()
    if problem == "existing":
        assert (destination / "keep.md").read_text() == "existing skill"
    else:
        assert not destination.exists()


def test_installation_release_pins_and_changelog_match_current_package() -> None:
    current = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
    pins = re.findall(r"--pin v([0-9.]+)", INSTALLATION.read_text())
    released = re.search(r"^## \[([0-9.]+)\] - \d{4}-\d{2}-\d{2}$",
                         (ROOT / "CHANGELOG.md").read_text(), re.MULTILINE)
    assert released is not None and pins and set(pins) == {released.group(1)}
    heading = re.search(r"^## \[(.+?)\]", (ROOT / "CHANGELOG.md").read_text(), re.MULTILINE)
    assert heading is not None and heading.group(1) == current


def test_bundled_prompt_is_identical_and_linked_from_skill() -> None:
    assert ONBOARDING.read_bytes() == PROMPT.read_bytes()
    skill = (ROOT / "skills" / "orbitdiff" / "SKILL.md").read_text()
    assert "references/onboarding.md" in skill
    assert "docs/prompt.md" not in skill


def test_documented_offline_commands_work_in_an_empty_isolated_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "isolated workspace"
    environment = dict(os.environ, PYTHONPATH=str(ROOT / "src"))
    commands = [
        shlex.split(line.strip()) for line in PROMPT.read_text().splitlines()
        if re.match(r"^   ORBIT_OS (?:--version|--help|doctor|demo|status|targets|report)\b", line)
    ]
    assert commands, "The prompt must include executable offline proof commands"
    ran_demo = False
    for command in commands:
        arguments = [str(workspace) if value == "WORKSPACE" else value for value in command[1:]]
        module = "orbit_os"
        result = subprocess.run(
            [sys.executable, "-m", module, *arguments], env=environment,
            text=True, capture_output=True, check=False, timeout=20,
        )
        assert result.returncode == 0, result.stderr
        if command[:2] == ["ORBIT_OS", "demo"]:
            demo = json.loads(result.stdout)
            assert demo["workspace"]["demo"] is True
            assert demo["personal"]["accounts"] and demo["watchlist"]
            ran_demo = True
        elif command[:2] == ["ORBIT_OS", "status"]:
            payload = json.loads(result.stdout)
            assert payload["personal"]["status"] == "missing"
            assert payload["watchlist"] == []
    assert ran_demo
    assert not workspace.exists(), "Documented inspection and demos must not initialize a real workspace"


def test_documented_login_command_refuses_agent_pipes() -> None:
    command = next(
        shlex.split(line.strip()) for line in ONBOARDING.with_name("authentication.md").read_text().splitlines()
        if line.startswith("orbit-os login ")
    )
    result = subprocess.run(
        [sys.executable, "-m", "orbit_os", *["atlas_studio" if value == "LOGIN_USERNAME" else value for value in command[1:]]],
        env=dict(os.environ, PYTHONPATH=str(ROOT / "src")),
        capture_output=True, text=True, check=False, timeout=15,
    )
    assert result.returncode == 2
    assert "local terminal" in result.stderr


def test_prompt_stays_public_safe() -> None:
    text = PROMPT.read_text()
    assert chr(0x2014) not in text
    assert "/users/" not in text.lower()
    assert "hermes" not in text.lower()
