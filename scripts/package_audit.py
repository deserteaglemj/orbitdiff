from __future__ import annotations

import argparse
import math
import re
import stat
import tarfile
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath, PureWindowsPath

MAX_MEMBER_SIZE = 10 * 1024 * 1024
TEXT_PATTERNS = (
    ("absolute home path", re.compile(r"/(?:Users|home)/[^/\s]+")),
    ("private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("github credential", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b")),
    ("telegram credential", re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{30,}\b")),
)
SENSITIVE_NAME = re.compile(
    r"(^\.env(?:\.|$)|session[-_.]|\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$)",
    re.IGNORECASE,
)
TOKEN = re.compile(r"[A-Za-z0-9_+=-]{40,}")
PRIVATE_COMPONENTS = {".ssh", ".git", ".hermes", ".remember"}


def entropy(value: str) -> float:
    counts = Counter(value)
    length = len(value)
    return -sum((count / length) * math.log2(count / length) for count in counts.values())


def _unsafe_path(name: str) -> bool:
    path = PurePosixPath(name)
    return (
        path.is_absolute()
        or ".." in path.parts
        or "\\" in name
        or bool(PureWindowsPath(name).drive)
    )


def _scan_text(name: str, content: bytes, forbidden: list[str]) -> list[str]:
    text = content.decode("utf-8", errors="ignore")
    findings = [f"{label}: {name}" for label, pattern in TEXT_PATTERNS if pattern.search(text)]
    findings.extend(f"forbidden value: {name}: {value}" for value in forbidden if value in text)
    if not name.endswith(".dist-info/RECORD") and any(
        entropy(token) >= 4.2 for token in TOKEN.findall(text)
    ):
        findings.append(f"high entropy token: {name}")
    return findings


def _scan_member(name: str, size: int, content: bytes, forbidden: list[str]) -> list[str]:
    findings: list[str] = []
    if _unsafe_path(name):
        findings.append(f"unsafe archive path: {name}")
    if any(
        part.casefold() in PRIVATE_COMPONENTS or SENSITIVE_NAME.search(part)
        for part in PurePosixPath(name).parts
    ):
        findings.append(f"sensitive filename or ancestor: {name}")
    if size > MAX_MEMBER_SIZE:
        findings.append(f"member too large: {name}")
        return findings
    return [*findings, *_scan_text(name, content, forbidden)]


def _scan_zip(path: Path, forbidden: list[str]) -> list[str]:
    findings: list[str] = []
    with zipfile.ZipFile(path) as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue
            mode = member.external_attr >> 16
            if member.create_system == 3 and stat.S_IFMT(mode) not in (0, stat.S_IFREG):
                findings.append(f"unsafe archive member type: {member.filename}")
                continue
            content = b"" if member.file_size > MAX_MEMBER_SIZE else archive.read(member)
            findings.extend(_scan_member(member.filename, member.file_size, content, forbidden))
    return findings


def _scan_tar(path: Path, forbidden: list[str]) -> list[str]:
    findings: list[str] = []
    with tarfile.open(path) as archive:
        for member in archive.getmembers():
            if member.isdir():
                continue
            if not member.isfile():
                findings.append(f"unsafe archive member type: {member.name}")
                continue
            if member.size > MAX_MEMBER_SIZE:
                content = b""
            else:
                extracted = archive.extractfile(member)
                if extracted is None:
                    findings.append(f"unreadable archive member: {member.name}")
                    continue
                content = extracted.read()
            findings.extend(_scan_member(member.name, member.size, content, forbidden))
    return findings


def scan_archive(path: Path, forbidden: list[str]) -> list[str]:
    try:
        findings = _scan_zip(path, forbidden) if path.suffix in {".whl", ".zip"} else _scan_tar(path, forbidden)
    except (OSError, tarfile.TarError, zipfile.BadZipFile):
        return ["unreadable archive"]
    return [f"{path.name}: {finding}" for finding in findings]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reject unsafe files from built package archives.")
    parser.add_argument("archives", nargs="+", type=Path)
    parser.add_argument("--forbid", action="append", default=[], help="Additional literal value to reject")
    args = parser.parse_args(argv)
    violations = sorted({finding for archive in args.archives for finding in scan_archive(archive, args.forbid)})
    if violations:
        print("PACKAGE-CONTENT: failed")
        print("\n".join(violations))
        return 1
    print("PACKAGE-CONTENT: clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
