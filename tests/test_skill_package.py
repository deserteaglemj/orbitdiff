from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).parents[1]
SKILL = ROOT / "skills" / "orbitdiff"


def test_skill_frontmatter_name_description_and_relative_references_are_valid() -> None:
    content = (SKILL / "SKILL.md").read_text(encoding="utf-8")
    frontmatter, body = content.split("---", 2)[1:]

    assert re.search(r"^name: orbitdiff$", frontmatter, re.MULTILINE)
    description = re.search(r"^description: (.+)$", frontmatter, re.MULTILINE)
    assert description is not None and len(description.group(1)) <= 1024
    assert "references/authentication.md" in body
    assert "references/scheduling.md" in body
    assert "references/safety.md" in body
    assert (SKILL / "agents" / "openai.yaml").is_file()


def test_skill_contains_boundaries_before_any_command_and_no_private_identifiers() -> None:
    content = (SKILL / "SKILL.md").read_text(encoding="utf-8")
    first_command = content.index("```bash")
    boundary = content[:first_command].lower()

    assert "public targets only" in boundary
    assert "never accept a password" in boundary
    public_text = content.lower().replace("deserteaglemj/orbitdiff", "")
    forbidden = ("/users/", "." + "hermes/", "telegram", "session-")
    assert not any(value in public_text for value in forbidden)


def test_openai_metadata_uses_local_svg_mark_and_safe_default_prompt() -> None:
    metadata = (SKILL / "agents" / "openai.yaml").read_text(encoding="utf-8")

    assert "OrbitDiff" in metadata
    assert 'icon_small: "./assets/orbitdiff-mark.svg"' in metadata
    assert 'icon_large: "./assets/orbitdiff-wordmark.svg"' in metadata
    assert "$orbitdiff" in metadata
    assert "public" in metadata.lower()
    assert (SKILL / "assets" / "orbitdiff-mark.svg").is_file()
    assert (SKILL / "assets" / "orbitdiff-wordmark.svg").is_file()


def test_standard_metadata_is_a_string_map_and_links_stay_inside_skill() -> None:
    content = (SKILL / "SKILL.md").read_text()
    frontmatter, body = content.split("---", 2)[1:]
    metadata_text = frontmatter.split("metadata:\n", 1)[1]
    metadata = {}
    for line in metadata_text.splitlines():
        if not line.strip():
            continue
        match = re.fullmatch(r"  ([a-z_-]+): (.+)", line)
        assert match is not None, "Skill metadata must be a flat string map"
        metadata[match.group(1)] = json.loads(match.group(2))
    assert all(isinstance(value, str) for value in metadata.values())
    assert metadata["version"] == tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
    for relative in re.findall(r"\]\((?!https?://)([^)]+)\)", body):
        target = (SKILL / relative).resolve()
        assert target.is_relative_to(SKILL.resolve())
        assert target.is_file(), relative
    assert len(content.splitlines()) < 500


def test_skill_evaluation_cases_have_unique_ids_and_concrete_expected_evidence() -> None:
    payload = json.loads((ROOT / "tests" / "skill_evals.json").read_text())
    assert payload["skill_name"] == "orbitdiff"
    cases = payload["evals"]
    assert cases, "The skill must include runnable evaluation scenarios"
    assert len({case["id"] for case in cases}) == len(cases)
    assert all(case["prompt"] and case["expected_output"] and case["assertions"] for case in cases)
    assert all(case["files"] for case in cases)
