"""Portable owned workspace shared by the CLI and desktop."""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import UTC, datetime, timedelta
from importlib.resources import files
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from platformdirs import user_data_dir


def default_workspace() -> Path:
    return Path(user_data_dir("orbit-os", appauthor=False))


def ensure_workspace(path: Path) -> Path:
    path = path.absolute()
    for component in (path, *path.parents):
        if component.name == ".ssh" or component.name == ".env" or component.name.startswith(".env."):
            raise ValueError("Choose an application workspace, not a protected location.")
        if component.is_symlink():
            raise ValueError("Choose a workspace without symbolic links.")
    path.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        path.chmod(0o700)
    return path


def load_workspace(workspace: Path) -> dict[str, Any]:
    from .personal import load_personal
    from .watchlist import load_watchlist

    result: dict[str, Any] = {
        "schema_version": 1, "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "personal": load_personal(workspace), "watchlist": [], "schedules": [], "issues": [],
        "workspace": {"mode": "portable", "demo": False, "can_import": True, "can_scan": True},
    }
    if result["personal"]["status"] == "error":
        result["issues"].append({
            "code": "personal_unreadable",
            "message": "The personal relationship history could not be read safely. Your saved data was not changed.",
        })
    try:
        result["watchlist"] = load_watchlist(workspace / "orbitdiff.sqlite3")
    except (OSError, ValueError, sqlite3.Error):
        result["issues"].append({
            "code": "watchlist_unreadable",
            "message": "The public watchlist could not be read safely. Your last saved data was not changed.",
        })
    return result


def demo_state() -> dict[str, Any]:
    """Exercise real import and collection logic in a disposable, isolated directory."""
    from orbitdiff.providers.fixture import FixtureProvider
    from orbitdiff.store import GraphStore

    from .personal import import_files

    def row(username: str) -> dict[str, Any]:
        return {"string_list_data": [{"value": username, "timestamp": 1}]}

    with TemporaryDirectory(prefix="orbit-os-demo-") as temporary:
        root = Path(temporary).resolve()
        now = datetime.now(UTC).replace(microsecond=0)
        for index, followers in enumerate((["nova_labs", "pixel_forge"], ["nova_labs", "ember_lab"])):
            documents = {
                "followers_1.json": json.dumps([row(name) for name in followers]).encode(),
                "following.json": json.dumps({
                    "relationships_following": [row("nova_labs"), row("pixel_forge")],
                }).encode(),
            }
            import_files(documents, root, account="orbit_demo",
                         captured_at=(now - timedelta(days=1 - index)).isoformat(),
                         complete_followers=True, complete_following=True)
        store = GraphStore(root / "orbitdiff.sqlite3")
        fixtures = files("orbitdiff").joinpath("fixtures")
        for name in ("baseline", "pending", "confirmed"):
            collection = FixtureProvider(Path(str(fixtures.joinpath(f"{name}.json")))).collect("atlas_studio")
            store.apply_collection(collection, baseline_run=name == "baseline")
        result = load_workspace(root)
    result["demo"] = True
    result["workspace"] = {"mode": "demo", "demo": True, "can_import": False, "can_scan": False}
    return result
