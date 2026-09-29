"""A loopback-only, read-only server for the Orbit OS workspace."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from . import __version__
from .data import load_state

ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/icon.svg": ("icon.svg", "image/svg+xml"),
    "/favicon.ico": ("icon.svg", "image/svg+xml"),
    "/manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json"),
}
CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; "
    "img-src 'self' data:; font-src 'self'; connect-src 'self'; "
    "manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
)


class OrbitServer(ThreadingHTTPServer):
    """Own no collector processes and expose no filesystem or mutation endpoint."""

    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        server_address: tuple[str, int],
        *,
        hermes_home: Path | None = None,
        web_root: Path | None = None,
    ) -> None:
        if server_address[0] != "127.0.0.1":
            raise ValueError("Orbit OS only accepts the 127.0.0.1 loopback address")
        self.hermes_home = hermes_home
        self.web_root = (web_root or Path(__file__).parent / "web").resolve()
        super().__init__(server_address, OrbitHandler)


class OrbitHandler(BaseHTTPRequestHandler):
    server: OrbitServer
    server_version = "OrbitOS"
    sys_version = ""

    def log_message(self, format: str, *args: Any) -> None:
        """Do not write personal request URLs or data to logs."""

    def _trusted_request(self) -> bool:
        authorities = {
            f"127.0.0.1:{self.server.server_port}",
            f"localhost:{self.server.server_port}",
        }
        if self.headers.get("Host", "").lower() not in authorities:
            return False
        origin = self.headers.get("Origin")
        if origin is not None and origin not in {f"http://{host}" for host in authorities}:
            return False
        return self.headers.get("Sec-Fetch-Site", "none") in {"same-origin", "none"}

    def _send(self, status: int, content: bytes, mime: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(content)

    def _json(self, status: int, data: dict[str, Any]) -> None:
        self._send(status, json.dumps(data, ensure_ascii=True, allow_nan=False).encode())

    def do_GET(self) -> None:
        if not self._trusted_request():
            self._json(403, {"error": "This workspace only accepts local, same-origin requests."})
            return
        path = urlsplit(self.path).path
        if path == "/api/health":
            self._json(200, {
                "app": "orbit-os",
                "version": __version__,
                "read_only": True,
                "source_mode": "default" if self.server.hermes_home is None else "custom",
            })
            return
        if path == "/api/state":
            try:
                self._json(200, load_state(self.server.hermes_home))
            except (OSError, ValueError, TypeError, KeyError):
                self._json(503, {"error": "Local data could not be read. Try refreshing shortly."})
            return
        asset = ASSETS.get(path)
        if asset is None:
            self._json(404, {"error": "Not found"})
            return
        filename, mime = asset
        asset_path = (self.server.web_root / filename).resolve()
        if not asset_path.is_relative_to(self.server.web_root):
            self._json(404, {"error": "Not found"})
            return
        try:
            content = asset_path.read_bytes()
        except OSError:
            self._json(404, {"error": "Not found"})
            return
        self._send(200, content, mime)

    def do_HEAD(self) -> None:
        self.do_GET()

    def _read_only(self) -> None:
        self._json(405, {"error": "Orbit OS provides a read-only local API."})

    do_POST = _read_only
    do_PUT = _read_only
    do_PATCH = _read_only
    do_DELETE = _read_only
    do_OPTIONS = _read_only
