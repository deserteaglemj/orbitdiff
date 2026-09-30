from __future__ import annotations

import os
import stat
from pathlib import Path

from platformdirs import user_data_dir

APP_NAME = "orbitdiff"


def validate_local_path(path: Path) -> Path:
    """Validate path components without resolving links or changing the filesystem."""
    for candidate in (path, path.absolute()):
        if any(
            part.lower() in {".env", ".ssh"} or part.lower().startswith(".env.")
            for part in candidate.parts
        ):
            raise OSError("protected paths cannot contain OrbitDiff storage")
        if ".." in candidate.parts:
            raise OSError("parent traversal is not permitted in storage paths")
    absolute = path.absolute()
    for component in (*reversed(absolute.parents), absolute):
        try:
            status = component.lstat()
        except FileNotFoundError:
            continue
        reparse = getattr(status, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
        if stat.S_ISLNK(status.st_mode) or reparse:
            raise OSError("linked storage paths are not permitted")
        if component != absolute and not stat.S_ISDIR(status.st_mode):
            raise OSError("storage ancestors must be directories")
    return absolute


def validate_database_path(path: Path) -> Path:
    """Reject linked databases and SQLite sidecars before any write or chmod."""
    path = validate_local_path(path)
    for candidate in (path, *(path.with_name(path.name + suffix) for suffix in ("-wal", "-shm", "-journal"))):
        validate_local_path(candidate)
        try:
            status = candidate.lstat()
            if candidate != path and stat.S_ISREG(status.st_mode) and status.st_nlink == 0:
                # SQLite can unlink a WAL/SHM file during stat. Recheck once;
                # validate any replacement instead of accepting its predecessor.
                validate_local_path(candidate)
                status = candidate.lstat()
        except FileNotFoundError:
            continue
        if not stat.S_ISREG(status.st_mode) or status.st_nlink != 1:
            raise OSError("database and sidecars must be regular files without links")
    return path


def ensure_private_directory(path: Path) -> Path:
    path = validate_local_path(path)
    missing: list[Path] = []
    current = path
    while not current.exists():
        missing.append(current)
        current = current.parent
    for directory in reversed(missing):
        try:
            directory.mkdir(mode=0o700)
        except FileExistsError:
            validate_local_path(directory)
    validate_local_path(path)
    if not path.is_dir():
        raise OSError("storage root must be a directory")
    if os.name != "nt":
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fchmod(descriptor, 0o700)
        finally:
            os.close(descriptor)
    return path


def default_data_dir() -> Path:
    return validate_local_path(Path(user_data_dir(APP_NAME)))


def database_path(data_dir: Path | None = None) -> Path:
    root = data_dir if data_dir is not None else default_data_dir()
    return validate_database_path(root / "orbitdiff.sqlite3")
