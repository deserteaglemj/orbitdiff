from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).parents[1]
PROMPT = ROOT / "docs" / "prompt.md"
ONBOARDING = ROOT / "skills" / "orbitdiff" / "references" / "onboarding.md"
PYPROJECT = ROOT / "pyproject.toml"
CHANGELOG = ROOT / "CHANGELOG.md"


def _prompt_text() -> str:
    return PROMPT.read_text(encoding="utf-8")


def test_prompt_pins_the_current_release_version() -> None:
    version = re.search(r'^version = "(.+)"$', PYPROJECT.read_text(encoding="utf-8"), re.MULTILINE)
    assert version is not None
    current = version.group(1)
    text = _prompt_text()

    assert f"orbitdiff.git@v{current}" in text
    assert f"--pin v{current}" in text
    assert f"v0.1.{int(current.rsplit('.', 1)[1]) - 1}" not in text


def test_prompt_mentions_the_latest_changelog_version() -> None:
    heading = re.search(r"^## \[(.+?)\]", CHANGELOG.read_text(encoding="utf-8"), re.MULTILINE)
    assert heading is not None
    assert f"v{heading.group(1)}" in _prompt_text()


def test_prompt_requests_instagram_session_safely_and_private_target_refusal() -> None:
    text = _prompt_text()

    assert "instaloader --login MY_INSTAGRAM_USERNAME" in text
    assert "never to you" in text
    assert "target turns out to be private" in text
    assert "never ask me for my instagram password" in text.lower()
    assert "orbitdiff init TARGET --login LOGIN" in text
    assert "orbitdiff scan TARGET --login LOGIN" in text
    assert "Which public Instagram username do you want to track first?" in text


def test_prompt_demo_expectation_uses_only_stable_text() -> None:
    text = _prompt_text()

    assert "following_stopped nova_labs (200) confirmed" in text
    assert "following_started ember_lab (300) confirmed" in text
    assert "timestamp varies" in text
    for forbidden in ("2026-01-01", "2026-09-1"):
        assert forbidden not in text


def test_bundled_onboarding_reference_stays_in_sync_with_the_repo_prompt() -> None:
    assert ONBOARDING.is_file(), "skills/orbitdiff/references/onboarding.md must exist for installed skills"
    assert ONBOARDING.read_bytes() == PROMPT.read_bytes()


def test_skill_points_at_the_bundled_onboarding_reference() -> None:
    skill = (ROOT / "skills" / "orbitdiff" / "SKILL.md").read_text(encoding="utf-8")

    assert "references/onboarding.md" in skill
    assert "docs/prompt.md" not in skill


def test_prompt_parses_profile_urls_without_query_or_trailing_slash_ambiguity() -> None:
    text = _prompt_text()

    assert "ignore the query string, fragment, and any trailing slash" in text
    assert "final path segment" not in text


def test_prompt_stays_public_safe() -> None:
    text = _prompt_text()

    assert chr(0x2014) not in text and chr(0x2013) not in text
    assert "/users/" not in text.lower()
    assert "hermes" not in text.lower()
    assert "telegram" not in text.lower()
