from __future__ import annotations

import re
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
    assert "../assets/orbitdiff-mark.svg" in metadata
    assert "public" in metadata.lower()
    assert (SKILL / "assets" / "orbitdiff-mark.svg").is_file()
    assert (SKILL / "assets" / "orbitdiff-wordmark.svg").is_file()
