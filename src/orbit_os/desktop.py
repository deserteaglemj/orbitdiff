"""Native window for the owned local Orbit OS server."""

from __future__ import annotations

import importlib
import sys
import threading
from pathlib import Path
from typing import Any

from .server import OrbitServer


def _load_webview() -> Any:
    # The command-line skill does not need the optional native window dependency.
    return importlib.import_module("webview")


def launch(workspace: Path | None = None, hermes_home: Path | None = None) -> int:
    """Run one native window and stop its server when the window closes."""
    if workspace is not None and hermes_home is not None:
        print("Choose either a portable workspace or a Hermes compatibility source.", file=sys.stderr)
        return 1
    try:
        webview = _load_webview()
    except ImportError:
        print(
            "The desktop dependency is missing. Install Orbit OS with its desktop extra "
            "or use the standalone desktop application.",
            file=sys.stderr,
        )
        return 1
    try:
        server = OrbitServer(("127.0.0.1", 0), workspace=workspace, hermes_home=hermes_home)
    except (OSError, ValueError):
        print("The local desktop server could not start.", file=sys.stderr)
        return 1
    thread = threading.Thread(
        target=server.serve_forever,
        kwargs={"poll_interval": 0.1},
        name="orbit-os-local-server",
        daemon=False,
    )
    thread.start()
    try:
        webview.settings["ALLOW_DOWNLOADS"] = True
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
        webview.settings["REMOTE_DEBUGGING_PORT"] = None
        webview.create_window(
            "Orbit OS",
            f"http://127.0.0.1:{server.server_port}",
            width=1240,
            height=860,
            min_size=(780, 580),
            background_color="#f5f6f4",
            text_select=True,
        )
        webview.start(private_mode=True, debug=False, http_server=False)
        return 0
    except Exception:
        # Native exceptions can include machine paths. Keep them out of public output.
        print("The native window could not open. Try the local browser app command.", file=sys.stderr)
        return 1
    finally:
        server.shutdown()
        server.server_close()
        thread.join()

