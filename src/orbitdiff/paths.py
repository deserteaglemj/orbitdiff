from __future__ import annotations

import os
from pathlib import Path

from platformdirs import user_data_dir

APP_NAME = "orbitdiff"


def ensure_private_directory(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        path.chmod(0o700)
    return path


def default_data_dir() -> Path:
    return ensure_private_directory(Path(user_data_dir(APP_NAME)))


def database_path(data_dir: Path | None = None) -> Path:
    root = ensure_private_directory(data_dir or default_data_dir())
    return root / "orbitdiff.sqlite3"
