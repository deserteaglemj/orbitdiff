"""Build the public OrbitDiff Agent Skill from an explicit, audited allowlist."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import stat
import sys
import tomllib
import zipfile
from pathlib import Path
from tempfile import NamedTemporaryFile

from package_audit import SENSITIVE_NAME, _scan_text

SKILL_FILES = (
    "SKILL.md",
    "agents/openai.yaml",
    "assets/orbitdiff-mark.svg",
    "assets/orbitdiff-wordmark.svg",
    "references/authentication.md",
    "references/commands.md",
    "references/installation.md",
    "references/onboarding.md",
    "references/personal-exports.md",
    "references/safety.md",
    "references/scheduling.md",
)
MAX_SOURCE_BYTES = 1024 * 1024
_PRIVATE_COMPONENTS = {".ssh", ".hermes", ".remember"}


def _check_path(path: Path) -> None:
    for component in (path, *path.parents):
        if component.is_symlink():
            raise ValueError("symbolic links are not allowed in build paths")
        if component.name in _PRIVATE_COMPONENTS or SENSITIVE_NAME.search(component.name):
            raise ValueError("private-data build path is not allowed")


def _read_public(path: Path) -> bytes:
    _check_path(path)
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_SOURCE_BYTES:
        raise ValueError("source file is not a bounded regular file")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        opened = os.fstat(stream.fileno())
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise ValueError("source changed while opening")
        data = stream.read(MAX_SOURCE_BYTES + 1)
        after = os.fstat(stream.fileno())
    if len(data) > MAX_SOURCE_BYTES or (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
        raise ValueError("source changed while reading")
    text = data.decode("utf-8")
    if chr(0x2014) in text or _scan_text(path.name, data, []):
        raise ValueError("public-safety validation rejected a source file")
    return data


def _atomic_write(path: Path, data: bytes) -> None:
    _check_path(path)
    with NamedTemporaryFile(prefix=".orbit-skill-", dir=path.parent, delete=False) as temporary:
        temporary.write(data)
        temporary.flush()
        os.fsync(temporary.fileno())
        staged = Path(temporary.name)
    try:
        staged.chmod(0o644)
        staged.replace(path)
    finally:
        staged.unlink(missing_ok=True)


def build_skill(source_root: Path, output_dir: Path) -> dict[str, str | int]:
    source_root, output_dir = source_root.absolute(), output_dir.absolute()
    _check_path(source_root)
    _check_path(output_dir)
    skill = source_root / "skills" / "orbitdiff"
    _check_path(skill)
    if output_dir.is_relative_to(skill):
        raise ValueError("an output directory inside the skill is not allowed")
    allowlist = {Path(name) for name in SKILL_FILES}
    allowed_directories = {parent for name in allowlist for parent in name.parents}
    for path in skill.rglob("*"):
        _check_path(path)
        relative = path.relative_to(skill)
        if (path.is_dir() and relative not in allowed_directories) or (not path.is_dir() and relative not in allowlist):
            raise ValueError("unlisted skill content is not allowed")
    entries = {f"orbitdiff/{name}": _read_public(skill / name) for name in SKILL_FILES}
    entries["orbitdiff/LICENSE"] = _read_public(source_root / "LICENSE")
    project = tomllib.loads(_read_public(source_root / "pyproject.toml").decode("utf-8"))
    version = project["project"]["version"]
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+(?:[a-z]+\d+)?", version):
        raise ValueError("invalid release version")
    frontmatter = entries["orbitdiff/SKILL.md"].decode("utf-8").split("---", 2)[1]
    match = re.search(r'^  version: "([^"]+)"$', frontmatter, re.MULTILINE)
    if match is None or match.group(1) != version:
        raise ValueError("skill and package version must match")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data, compresslevel=9)
    data = buffer.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    output_dir.mkdir(parents=True, exist_ok=True)
    archive_path = output_dir / f"orbitdiff-skill-{version}.zip"
    checksum_path = archive_path.with_suffix(".zip.sha256")
    _atomic_write(archive_path, data)
    _atomic_write(checksum_path, f"{digest}  {archive_path.name}\n".encode("ascii"))
    return {"archive": str(archive_path), "sha256_file": str(checksum_path), "sha256": digest, "files": len(entries)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path(__file__).parents[1])
    parser.add_argument("--output-dir", type=Path, default=Path("dist"))
    args = parser.parse_args(argv)
    try:
        receipt = build_skill(args.source_root, args.output_dir)
    except (OSError, ValueError, KeyError, IndexError) as error:
        print(f"Skill build failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(receipt, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
