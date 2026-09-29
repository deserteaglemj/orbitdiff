from __future__ import annotations

import runpy
import subprocess
import sys
from pathlib import Path
from secrets import token_urlsafe

ROOT = Path(__file__).parents[1]
SCANNER = ROOT / "scripts" / "public_safety_scan.py"


def run_scan(path: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCANNER), str(path), *extra],
        check=False,
        capture_output=True,
        text=True,
    )


def test_public_safety_scan_accepts_clean_public_text(tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text("Public synthetic documentation for atlas_studio.\n")

    result = run_scan(tmp_path)

    assert result.returncode == 0
    assert "clean" in result.stdout.lower()


def test_public_safety_scan_rejects_sensitive_files_and_generic_secret_shapes(tmp_path: Path) -> None:
    cases = {
        "orbitdiff.sqlite3": "SQLite format 3\x00",
        "orbitdiff.sqlite3-wal": "Synthetic write-ahead log",
        "orbitdiff.sqlite3-shm": "Synthetic shared-memory index",
        "session-analyst": "opaque material",
        "paths.md": "/" + "Users" + "/example/private.txt\n",
        "key.pem": "-----BEGIN " + "PRIVATE KEY-----\n",
        "github.txt": "ghp_" + ("a" * 36) + "\n",
        "telegram.txt": "123456789:" + ("a" * 31) + "\n",
        "entropy.txt": token_urlsafe(36) + "\n",
    }
    for name, content in cases.items():
        (tmp_path / name).write_text(content)

    result = run_scan(tmp_path, "--forbid", "private.txt")

    assert result.returncode == 1
    for expected in ("sensitive filename", "absolute home path", "private key", "github", "telegram", "high entropy"):
        assert expected in result.stdout.lower()
    assert "private.txt" in result.stdout
    assert "sensitive filename: orbitdiff.sqlite3-wal" in result.stdout
    assert "sensitive filename: orbitdiff.sqlite3-shm" in result.stdout


def test_sensitive_environment_names_are_rejected_without_opening_them() -> None:
    module = runpy.run_path(str(SCANNER))
    pattern = module["SENSITIVE_NAME"]
    assert pattern.search(".env")
    assert pattern.search(".env.local")


def test_private_local_receipts_are_not_release_candidates(tmp_path: Path) -> None:
    for dirname in (".remember", ".orbit-local"):
        directory = tmp_path / dirname
        directory.mkdir()
        (directory / "private.txt").write_text("CONFIDENTIAL_LOCAL_ONLY")
    cache_dir = tmp_path / ".impeccable"
    cache_dir.mkdir()
    (cache_dir / "hook.cache.json").write_text("CONFIDENTIAL_LOCAL_ONLY")
    result = run_scan(tmp_path, "--forbid", "CONFIDENTIAL_LOCAL_ONLY")
    assert result.returncode == 0
