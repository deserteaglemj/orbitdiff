from __future__ import annotations

import io
import stat
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path
from secrets import token_urlsafe

import pytest

ROOT = Path(__file__).parents[1]
AUDIT = ROOT / "scripts" / "package_audit.py"
MAX_MEMBER_SIZE = 10 * 1024 * 1024


def run_audit(*archives: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(AUDIT), *(str(archive) for archive in archives)],
        check=False,
        capture_output=True,
        text=True,
    )


def write_wheel(path: Path, members: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        for name, content in members.items():
            archive.writestr(name, content)


def write_sdist(path: Path, members: dict[str, bytes]) -> None:
    with tarfile.open(path, "w:gz") as archive:
        for name, content in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))


def test_package_audit_rejects_posix_symlink_wheel_member(tmp_path: Path) -> None:
    wheel = tmp_path / "symlink.whl"
    link = zipfile.ZipInfo("orbitdiff/link.py")
    link.create_system = 3
    link.external_attr = (stat.S_IFLNK | 0o777) << 16
    with zipfile.ZipFile(wheel, "w") as archive:
        archive.writestr(link, b"module.py")

    result = run_audit(wheel)

    assert result.returncode == 1
    assert "unsafe archive member type: orbitdiff/link.py" in result.stdout


def test_package_audit_rejects_unsafe_archive_member_bytes_and_names(tmp_path: Path) -> None:
    unsafe_wheel = tmp_path / "unsafe.whl"
    unsafe_sdist = tmp_path / "unsafe.tar.gz"
    unsafe_name = tmp_path / "unsafe-name.whl"
    write_wheel(unsafe_wheel, {"orbitdiff/module.py": b"ghp_" + b"a" * 36})
    write_sdist(unsafe_sdist, {"orbitdiff-0.1.0/notes.txt": b"/" + b"Users/example/private.txt"})
    write_wheel(unsafe_name, {"orbitdiff/.env": b"PUBLIC=value"})

    result = run_audit(unsafe_wheel, unsafe_sdist, unsafe_name)

    assert result.returncode == 1
    assert "PACKAGE-CONTENT: failed" in result.stdout
    assert "github credential" in result.stdout
    assert "absolute home path" in result.stdout
    assert "sensitive filename" in result.stdout


def test_package_audit_accepts_clean_archives_and_generated_record_tokens(tmp_path: Path) -> None:
    clean_wheel = tmp_path / "clean.whl"
    clean_sdist = tmp_path / "clean.tar.gz"
    record = f"orbitdiff/module.py,sha256={token_urlsafe(48)},123\n".encode()
    write_wheel(
        clean_wheel,
        {
            "orbitdiff/module.py": b"PUBLIC_TARGET = 'atlas_studio'\n",
            "orbitdiff-0.1.0.dist-info/RECORD": record,
        },
    )
    write_sdist(clean_sdist, {"orbitdiff-0.1.0/orbitdiff/module.py": b"PUBLIC = True\n"})

    result = run_audit(clean_wheel, clean_sdist)

    assert result.returncode == 0
    assert "PACKAGE-CONTENT: clean" in result.stdout


def test_package_audit_fails_closed_on_traversal_and_large_members(tmp_path: Path) -> None:
    traversal = tmp_path / "traversal.whl"
    oversized = tmp_path / "oversized.tar.gz"
    write_wheel(traversal, {"../orbitdiff/module.py": b"PUBLIC = True\n"})
    write_sdist(oversized, {"orbitdiff-0.1.0/payload.txt": b"x" * (MAX_MEMBER_SIZE + 1)})

    result = run_audit(traversal, oversized)

    assert result.returncode == 1
    assert "unsafe archive path" in result.stdout
    assert "member too large" in result.stdout


@pytest.mark.parametrize("name", ["C:/outside.txt", "C:outside.txt", r"..\outside.txt", r"\outside.txt", r"orbitdiff\..\outside.txt"])
@pytest.mark.parametrize("kind", ["zip", "tar"])
def test_package_audit_rejects_paths_that_escape_on_windows(tmp_path: Path, name: str, kind: str) -> None:
    archive = tmp_path / ("candidate.zip" if kind == "zip" else "candidate.tar.gz")
    writer = write_wheel if kind == "zip" else write_sdist
    writer(archive, {name: b"synthetic public sample"})

    result = run_audit(archive)

    assert result.returncode == 1
    assert "unsafe archive path" in result.stdout


@pytest.mark.parametrize("name", ["orbitdiff/.ssh/synthetic.txt", "orbitdiff/.HeRmEs/notes.txt", "orbitdiff/.git/config", "orbitdiff/.remember/notes.md", "orbitdiff/.ENV/cache.txt", "orbitdiff/session-example/notes.txt"])
@pytest.mark.parametrize("kind", ["zip", "tar"])
def test_package_audit_rejects_private_ancestors(tmp_path: Path, name: str, kind: str) -> None:
    archive = tmp_path / ("candidate.zip" if kind == "zip" else "candidate.tar.gz")
    writer = write_wheel if kind == "zip" else write_sdist
    writer(archive, {name: b"synthetic public sample"})

    result = run_audit(archive)

    assert result.returncode == 1
    assert "sensitive" in result.stdout


@pytest.mark.parametrize("name", ["../../outside/", "C:/outside/", "orbitdiff/.ssh/"])
@pytest.mark.parametrize("kind", ["zip", "tar"])
def test_package_audit_checks_directory_entries(tmp_path: Path, name: str, kind: str) -> None:
    archive = tmp_path / ("candidate.zip" if kind == "zip" else "candidate.tar.gz")
    if kind == "zip":
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr(name, b"")
    else:
        with tarfile.open(archive, "w:gz") as bundle:
            member = tarfile.TarInfo(name)
            member.type = tarfile.DIRTYPE
            bundle.addfile(member)

    result = run_audit(archive)

    assert result.returncode == 1
    assert "unsafe archive path" in result.stdout or "sensitive" in result.stdout
