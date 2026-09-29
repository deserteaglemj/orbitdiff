from __future__ import annotations

import argparse
import math
import re
from collections import Counter
from pathlib import Path

TEXT_PATTERNS = (
    ("absolute home path", re.compile(r"/(?:Users|home)/[^/\s]+")),
    ("private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("github credential", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b")),
    ("telegram credential", re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{30,}\b")),
)
SKIP_DIRECTORIES = {
    ".git",
    ".remember",
    ".orbit-local",
    ".superpowers",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".venv",
    ".wheel-venv",
    ".wheel-proof",
    "__pycache__",
    "build",
    "dist",
}
SENSITIVE_NAME = re.compile(
    r"(^\.env(?:\.|$)|session[-_.]|\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$)",
    re.IGNORECASE,
)
TOKEN = re.compile(r"[A-Za-z0-9_+=-]{40,}")
LOCAL_CACHE_FILES = {Path(".impeccable/hook.cache.json")}


def entropy(value: str) -> float:
    counts = Counter(value)
    length = len(value)
    return -sum((count / length) * math.log2(count / length) for count in counts.values())


def candidate_files(root: Path) -> list[Path]:
    return [
        path
        for path in root.rglob("*")
        if path.is_file()
        and path.relative_to(root) not in LOCAL_CACHE_FILES
        and not any(
            part in SKIP_DIRECTORIES or part.endswith(".egg-info")
            for part in path.relative_to(root).parts
        )
    ]


def scan(root: Path, forbidden: list[str]) -> list[str]:
    findings: list[str] = []
    for path in candidate_files(root):
        relative = path.relative_to(root)
        if SENSITIVE_NAME.search(path.name):
            findings.append(f"sensitive filename: {relative}")
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for label, pattern in TEXT_PATTERNS:
            if pattern.search(text):
                findings.append(f"{label}: {relative}")
        if "\u2014" in text:
            findings.append(f"em dash: {relative}")
        for value in forbidden:
            if value in text:
                findings.append(f"forbidden value: {relative}: {value}")
        if any(entropy(token) >= 4.2 for token in TOKEN.findall(text)):
            findings.append(f"high entropy token: {relative}")
    return sorted(set(findings))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scan a release candidate for public-safety violations.")
    parser.add_argument("path", nargs="?", type=Path, default=Path("."))
    parser.add_argument("--forbid", action="append", default=[], help="Additional literal value to reject")
    args = parser.parse_args(argv)
    if not args.path.is_dir():
        parser.error(f"not a directory: {args.path}")
    findings = scan(args.path, args.forbid)
    if findings:
        print("PUBLIC-SAFETY: failed")
        print("\n".join(findings))
        return 1
    print(f"PUBLIC-SAFETY: clean ({len(candidate_files(args.path))} files scanned)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
