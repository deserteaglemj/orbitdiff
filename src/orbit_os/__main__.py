"""Run with python -m orbit_os or the orbit-os command."""

from __future__ import annotations

import argparse
import json
import sys
import webbrowser
from email.message import Message
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from . import __version__
from .server import OrbitServer


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
        )
    except (URLError, OSError, ValueError):
        return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Open your private Orbit OS relationship workspace.")
    parser.add_argument("--port", type=int, default=8767, help="Local port (default: 8767)")
    parser.add_argument("--open", action="store_true", help="Open the workspace in your browser")
    parser.add_argument("--hermes-home", type=Path, help="Read artifacts from a different Hermes home")
    parser.add_argument("--version", action="version", version=f"Orbit OS {__version__}")
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    url = f"http://127.0.0.1:{args.port}"
    try:
        server = OrbitServer(("127.0.0.1", args.port), hermes_home=args.hermes_home)
    except OSError:
        if args.hermes_home is None and _existing_app(url):
            print(f"Orbit OS is already running at {url}")
            if args.open:
                webbrowser.open(url)
            return 0
        print("This local port is unavailable. Choose a different --port.", file=sys.stderr)
        return 1
    print(f"Orbit OS {__version__} is ready at {url}", flush=True)
    print("Private local workspace. Press Ctrl+C to stop.", flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nOrbit OS stopped.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
