from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).parents[1]
PROMPT = ROOT / "docs" / "prompt.md"
ONBOARDING = ROOT / "skills" / "orbitdiff" / "references" / "onboarding.md"


def test_prompt_release_pins_and_changelog_match_current_package() -> None:
    current = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
    prompt = PROMPT.read_text()
    pins = re.findall(r"(?:orbitdiff\.git@v|--pin v)([0-9.]+)", prompt)
    assert pins and set(pins) == {current}
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
        if re.match(r"^   ORBIT_OS (?:--version|doctor|demo|status|targets|report)\b", line)
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
    assert not list(workspace.iterdir()), "Offline demonstrations must not seed the real workspace"


def test_documented_login_command_refuses_agent_pipes() -> None:
    command = next(
        shlex.split(line.strip()) for line in PROMPT.read_text().splitlines()
        if line.startswith("   ORBIT_OS login ")
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
