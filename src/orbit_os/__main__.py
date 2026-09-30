"""Run with python -m orbit_os or the orbit-os command."""

from __future__ import annotations

import json
import sys
import webbrowser
from email.message import Message
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from . import __version__


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(
        self, req: Request, fp: Any, code: int, msg: str, headers: Message, newurl: str
    ) -> None:
        return None


def _existing_app(url: str) -> bool:
    try:
        opener = build_opener(ProxyHandler({}), _NoRedirects())
        with opener.open(f"{url}/api/health", timeout=2) as response:
            payload = json.loads(response.read(4096))
        return (
            isinstance(payload, dict)
            and payload.get("app") == "orbit-os"
            and payload.get("version") == __version__
            and payload.get("source_mode") == "default"
            and payload.get("portable_schema") == 1
        )
    except (URLError, OSError, ValueError):
        return False


def serve(*, port: int = 8767, open_browser: bool = False, workspace: Path | None = None,
          hermes_home: Path | None = None) -> int:
    from .server import OrbitServer

    if not 1 <= port <= 65535:
        raise ValueError("port must be between 1 and 65535")
    url = f"http://127.0.0.1:{port}"
    try:
        server = OrbitServer(("127.0.0.1", port), workspace=workspace, hermes_home=hermes_home)
    except OSError:
        if hermes_home is None and workspace is None and _existing_app(url):
            print(f"Orbit OS is already running at {url}")
            if open_browser:
                webbrowser.open(url)
            return 0
        print("This local port is unavailable. Choose a different --port.", file=sys.stderr)
        return 1
    print(f"Orbit OS {__version__} is ready at {url}", flush=True)
    print("Private local workspace. Press Ctrl+C to stop.", flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nOrbit OS stopped.")
    finally:
        server.server_close()
    return 0


def main(argv: list[str] | None = None) -> int:
    from .cli import main as run
    return run(argv)


if __name__ == "__main__":
    raise SystemExit(main())
