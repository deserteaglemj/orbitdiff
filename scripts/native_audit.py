"""Audit a native runtime separately from the strict skill and wheel audit."""

from __future__ import annotations

import argparse
import hashlib
import json
import plistlib
import re
import stat
import subprocess
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

MAX_FILE_SIZE = 128 * 1024 * 1024
MAX_TOTAL_SIZE = 500 * 1024 * 1024
MAX_FILES = 8000
MAX_INVENTORY_SIZE = 4 * 1024 * 1024
MANIFEST = "Contents/Resources/orbit-distribution.json"
SENSITIVE_NAME = re.compile(
    r"(^\.env(?:\.|$)|^session[-_.]|\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$)",
    re.IGNORECASE,
)
PRIVATE_PATTERNS = (
    ("absolute home path", re.compile(rb"/(?:Users|home)/[^/\s\x00]+")),
    ("private key", re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("github credential", re.compile(rb"\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b")),
)
RUNTIME_PACKAGES = frozenset({
    "AppKit", "Cocoa", "CoreFoundation", "CoreGraphics", "CoreImage", "CoreText",
    "Foundation", "ImageIO", "PDFKit", "PyObjCTools", "Quartz", "QuartzCore",
    "QuartzFilters", "QuickLookUI", "Security", "UniformTypeIdentifiers", "WebKit",
    "certifi", "charset_normalizer", "objc", "webview", "lib-dynload",
})


def _allowed(relative: str) -> bool:
    parts = PurePosixPath(relative).parts
    if relative in {"Contents/Info.plist", "Contents/MacOS/orbit-os", MANIFEST}:
        return True
    if relative.startswith("Contents/_CodeSignature/"):
        return parts[-1] == "CodeResources"
    if len(parts) < 3 or parts[0] != "Contents" or parts[1] not in {"Frameworks", "Resources"}:
        return False
    name = parts[2]
    # PyInstaller mirrors data and runtime folders using internal relative links.
    if len(parts) == 3 and name in {
        "Python", "Python.framework", "Python3.framework", "python3.13", "python3.14",
        "licenses", "THIRD_PARTY_NOTICES.txt", "base_library.zip", "orbit_os", "orbitdiff",
        "orbitdiff.egg-info",
    }:
        return True
    if len(parts) == 3 and name.endswith(".dylib"):
        return True
    if parts[1] == "Frameworks":
        return (
            name in RUNTIME_PACKAGES
            or name in {"Python", "Python.framework", "Python3.framework", "python3.13", "python3.14", "python3__dot__13", "python3__dot__14"}
            or (len(parts) == 3 and name.endswith((".so", ".dylib")))
        )
    if name in {"licenses", "THIRD_PARTY_NOTICES.txt", "base_library.zip", "icon-windowed.icns", "orbit-os.icns"}:
        return True
    if name in RUNTIME_PACKAGES:
        return True
    if name.endswith(".dist-info"):
        return name.startswith(("pywebview-", "proxy_tools-", "bottle-"))
    if name == "orbitdiff.egg-info" and len(parts) == 4:
        return parts[3] in {
            "PKG-INFO", "SOURCES.txt", "dependency_links.txt", "entry_points.txt",
            "requires.txt", "top_level.txt",
        }
    if name == "orbit_os" and len(parts) == 5 and parts[3] == "web":
        return parts[4] in {"index.html", "app.js", "styles.css", "icon.svg", "manifest.webmanifest"}
    if name == "orbitdiff" and len(parts) == 5 and parts[3] == "fixtures":
        return parts[4].endswith(".json")
    return False


def _private_content(relative: str, content: bytes, forbidden: list[str]) -> list[str]:
    findings = [f"{label}: {relative}" for label, pattern in PRIVATE_PATTERNS if pattern.search(content)]
    findings.extend(f"forbidden value: {relative}" for value in forbidden if value.encode() in content)
    return findings


def _zip_content(relative: str, path: Path, forbidden: list[str]) -> list[str]:
    findings: list[str] = []
    total = 0
    try:
        with zipfile.ZipFile(path) as archive:
            members = archive.infolist()
            if len(members) > MAX_FILES:
                return [f"too many archive members: {relative}"]
            for member in members:
                member_path = PurePosixPath(member.filename)
                if member_path.is_absolute() or ".." in member_path.parts:
                    findings.append(f"unsafe archive member: {relative}")
                    continue
                if member.is_dir():
                    continue
                mode = member.external_attr >> 16
                if member.create_system == 3 and stat.S_IFMT(mode) not in (0, stat.S_IFREG):
                    findings.append(f"unsafe archive member type: {relative}")
                    continue
                if SENSITIVE_NAME.search(member_path.name):
                    findings.append(f"sensitive archive filename: {relative}")
                    continue
                total += member.file_size
                if member.file_size > MAX_FILE_SIZE or total > MAX_TOTAL_SIZE:
                    findings.append(f"archive resource limit: {relative}")
                    break
                findings.extend(_private_content(relative, archive.read(member), forbidden))
    except (OSError, zipfile.BadZipFile):
        findings.append(f"unreadable runtime archive: {relative}")
    return findings


def _read_manifest(bundle: Path) -> tuple[dict[str, Any], list[str]]:
    path = bundle / MANIFEST
    try:
        if path.is_symlink() or path.stat().st_size > MAX_INVENTORY_SIZE:
            return {}, ["invalid distribution inventory"]
        manifest = json.loads(path.read_text())
        if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
            return {}, ["invalid distribution inventory"]
        if not isinstance(manifest.get("files"), dict) or not isinstance(manifest.get("dependencies"), list):
            return {}, ["invalid distribution inventory"]
        return manifest, []
    except (OSError, ValueError):
        return {}, ["missing or unreadable distribution inventory"]


def audit_bundle(bundle: Path, *, forbidden: list[str] | None = None) -> list[str]:
    """Reject paths, unlisted content, unsafe links, private data, and absent licenses."""
    forbidden = forbidden or []
    if bundle.is_symlink() or not bundle.is_dir() or bundle.suffix != ".app":
        return ["expected a regular macOS application directory"]
    bundle = bundle.resolve()
    if any((bundle / name).is_symlink() for name in (
        "Contents", "Contents/Resources", "Contents/Frameworks", "Contents/MacOS",
    )):
        return ["symlinked bundle directory"]
    manifest, findings = _read_manifest(bundle)
    files = manifest.get("files", {})
    seen: set[str] = set()
    total = 0
    for index, path in enumerate(bundle.rglob("*")):
        if index >= MAX_FILES:
            findings.append("too many bundle members")
            break
        relative = path.relative_to(bundle).as_posix()
        mode = path.lstat().st_mode
        if any(SENSITIVE_NAME.search(part) or part in {".ssh", ".git", ".remember", ".orbit-local"}
               for part in PurePosixPath(relative).parts):
            findings.append(f"sensitive filename: {relative}")
            continue
        if stat.S_ISDIR(mode):
            continue
        if not _allowed(relative):
            findings.append(f"outside runtime allowlist: {relative}")
        seen.add(relative)
        entry = files.get(relative)
        if relative != MANIFEST and not relative.startswith("Contents/_CodeSignature/") and not isinstance(entry, dict):
            findings.append(f"not in inventory: {relative}")
        if stat.S_ISLNK(mode):
            target = path.readlink()
            try:
                resolved = path.resolve(strict=True)
                if target.is_absolute() or not resolved.is_relative_to(bundle):
                    findings.append(f"symlink escapes bundle: {relative}")
            except (OSError, RuntimeError):
                findings.append(f"broken or cyclic symlink: {relative}")
            if isinstance(entry, dict) and entry.get("symlink") != str(target):
                findings.append(f"symlink inventory mismatch: {relative}")
            continue
        if not stat.S_ISREG(mode):
            findings.append(f"unsafe bundle member type: {relative}")
            continue
        size = path.stat().st_size
        total += size
        if size > MAX_FILE_SIZE:
            findings.append(f"member too large: {relative}")
            continue
        if total > MAX_TOTAL_SIZE:
            findings.append("bundle exceeds size limit")
            break
        content = path.read_bytes()
        if isinstance(entry, dict):
            if entry.get("integrity") == "macos-code-signature":
                if relative != "Contents/MacOS/orbit-os":
                    findings.append(f"invalid code-signature inventory entry: {relative}")
                else:
                    try:
                        subprocess.run(
                            ["codesign", "--verify", "--deep", "--strict", str(bundle)],
                            check=True, capture_output=True, timeout=30,
                        )
                    except (OSError, subprocess.SubprocessError):
                        findings.append("invalid macOS code signature")
            elif entry.get("size") != size or entry.get("sha256") != hashlib.sha256(content).hexdigest():
                findings.append(f"hash mismatch: {relative}")
        findings.extend(_private_content(relative, content, forbidden))
        if path.suffix == ".zip":
            findings.extend(_zip_content(relative, path, forbidden))
    for name in files:
        if name not in seen:
            findings.append(f"inventory member missing: {name}")
    try:
        info_path = bundle / "Contents/Info.plist"
        if info_path.is_symlink() or info_path.stat().st_size > MAX_INVENTORY_SIZE:
            raise ValueError("invalid property list")
        info = plistlib.loads(info_path.read_bytes())
        if not isinstance(info, dict):
            raise ValueError("invalid property list")
        if info.get("CFBundleIdentifier") != "com.orbitdiff.orbitos" or info.get("CFBundleExecutable") != "orbit-os":
            findings.append("unexpected application identity")
        if info.get("CFBundleShortVersionString") != manifest.get("app_version"):
            findings.append("application version does not match inventory")
    except (OSError, ValueError, plistlib.InvalidFileException):
        findings.append("invalid application property list")
    dependencies = manifest.get("dependencies", [])
    if not dependencies:
        findings.append("missing dependency inventory")
    for dependency in dependencies:
        if not isinstance(dependency, dict) or not dependency.get("name") or not dependency.get("version"):
            findings.append("invalid dependency inventory entry")
            continue
        licenses = dependency.get("licenses", [])
        if not isinstance(licenses, list) or not licenses:
            findings.append(f"missing dependency license: {dependency['name']}")
            continue
        for license_path in licenses:
            path = PurePosixPath(str(license_path))
            expected = f"Contents/Resources/{path.as_posix()}"
            if not path.parts or path.is_absolute() or ".." in path.parts or path.parts[0] != "licenses" or expected not in seen:
                findings.append(f"missing dependency license: {dependency['name']}")
    return sorted(set(findings))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit a self-contained macOS Orbit OS application.")
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--forbid", action="append", default=[])
    args = parser.parse_args(argv)
    findings = audit_bundle(args.bundle, forbidden=args.forbid)
    if findings:
        print("NATIVE-CONTENT: failed")
        print("\n".join(findings))
        return 1
    print("NATIVE-CONTENT: clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
