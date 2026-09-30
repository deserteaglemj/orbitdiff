from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from orbitdiff import paths


def test_database_resolution_does_not_create_or_chmod_storage(tmp_path: Path) -> None:
    root = tmp_path / "new"
    assert paths.database_path(root) == root / "orbitdiff.sqlite3"
    assert not root.exists()
    root.mkdir(mode=0o755)
    before = root.stat().st_mode
    paths.database_path(root)
    assert root.stat().st_mode == before


def test_default_directory_resolution_is_read_only(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "default"
    monkeypatch.setattr(paths, "user_data_dir", lambda _name: str(root))
    assert paths.default_data_dir() == root
    assert not root.exists()


@pytest.mark.parametrize("method", ["ensure_private_directory", "database_path"])
def test_linked_directory_rejected_before_chmod(tmp_path: Path, method: str) -> None:
    outside = tmp_path / "outside"
    outside.mkdir(mode=0o755)
    alias = tmp_path / "alias"
    alias.symlink_to(outside, target_is_directory=True)
    before = outside.stat().st_mode
    with pytest.raises(OSError, match="link"):
        getattr(paths, method)(alias)
    assert outside.stat().st_mode == before


def test_database_resolution_rejects_link_before_mutating_parent(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.write_bytes(b"unchanged")
    root = tmp_path / "workspace"
    root.mkdir(mode=0o755)
    (root / "orbitdiff.sqlite3").symlink_to(outside)
    before = root.stat().st_mode
    with pytest.raises(OSError, match="link"):
        paths.database_path(root)
    assert root.stat().st_mode == before
    assert outside.read_bytes() == b"unchanged"


@pytest.mark.parametrize("component", [".env", ".env.local", ".ssh"])
def test_protected_paths_rejected_before_filesystem_mutation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, component: str) -> None:
    def forbidden_mutation(*_args: object, **_kwargs: object) -> None:
        pytest.fail("Protected paths must be rejected before filesystem mutation.")

    monkeypatch.setattr(Path, "mkdir", forbidden_mutation)
    monkeypatch.setattr(Path, "chmod", forbidden_mutation)
    with pytest.raises(OSError, match="protected"):
        paths.ensure_private_directory(tmp_path / component / "new")
    with pytest.raises(OSError, match="protected"):
        paths.database_path(tmp_path / component)


def test_new_private_directory_has_private_mode(tmp_path: Path) -> None:
    root = tmp_path / "new" / "nested"
    assert paths.ensure_private_directory(root) == root
    assert stat.S_IMODE(root.stat().st_mode) == 0o700
    assert stat.S_IMODE(root.parent.stat().st_mode) == 0o700


@pytest.mark.parametrize('replacement', ['missing', 'hardlink', 'symlink'])
def test_unlinked_sqlite_sidecar_is_rechecked_without_accepting_replacement_links(tmp_path, monkeypatch, replacement):
    database = tmp_path / 'orbitdiff.sqlite3'
    database.touch()
    sidecar = tmp_path / 'orbitdiff.sqlite3-wal'
    sidecar.write_text('synthetic WAL')
    outside = tmp_path / 'preserved'
    outside.write_text('unchanged')
    original = Path.lstat
    calls = 0

    def raced(path, *args, **kwargs):
        nonlocal calls
        result = original(path, *args, **kwargs)
        if path == sidecar:
            calls += 1
            if calls == 2:
                sidecar.unlink()
                if replacement == 'hardlink':
                    os.link(outside, sidecar)
                elif replacement == 'symlink':
                    sidecar.symlink_to(outside)
                fields = list(result)
                fields[3] = 0
                return os.stat_result(fields)
        return result

    monkeypatch.setattr(Path, 'lstat', raced)
    if replacement == 'missing':
        assert paths.validate_database_path(database) == database
    else:
        with pytest.raises(OSError, match='link'):
            paths.validate_database_path(database)
    assert outside.read_text() == 'unchanged'
