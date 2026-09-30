"""Loopback workspace views and narrowly scoped, explicit local controls."""

from __future__ import annotations

import argparse
import base64
import hmac
import json
import secrets
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from orbitdiff.providers.base import InvalidTargetError

from . import __version__
from .data import load_state
from .workspace import default_workspace, demo_state, ensure_workspace, load_workspace

MAX_REQUEST_BYTES = 40 * 1024 * 1024

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
    "manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
)


class OrbitServer(ThreadingHTTPServer):
    """Keep all state local and collect only through an explicit protected action."""

    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        server_address: tuple[str, int],
        *,
        workspace: Path | None = None,
        hermes_home: Path | None = None,
        web_root: Path | None = None,
    ) -> None:
        if server_address[0] != "127.0.0.1":
            raise ValueError("Orbit OS only accepts the 127.0.0.1 loopback address")
        if workspace is not None and hermes_home is not None:
            raise ValueError("Select one workspace source")
        self.hermes_home = hermes_home
        self.workspace = workspace or default_workspace()
        self.source_mode = "custom" if workspace is not None or hermes_home is not None else "default"
        self.control_token = secrets.token_urlsafe(32)
        self.control_lock = threading.Lock()
        self.control_admission = threading.Lock()
        self.closing = False
        self.web_root = (web_root or Path(__file__).parent / "web").resolve()
        super().__init__(server_address, OrbitHandler)

    def begin_control(self) -> bool:
        with self.control_admission:
            return not self.closing and self.control_lock.acquire(blocking=False)

    def server_close(self) -> None:
        with self.control_admission:
            self.closing = True
        super().server_close()
        # Finish an admitted import or scan before a native window can exit.
        with self.control_lock:
            pass


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
                "read_only": self.server.hermes_home is not None,
                "source_mode": self.server.source_mode,
                "portable_schema": 1,
            })
            return
        if path == "/api/state":
            try:
                if self.server.hermes_home is not None:
                    state = load_state(self.server.hermes_home)
                    state["workspace"] = {"mode": "hermes", "demo": False, "can_import": False, "can_scan": False}
                else:
                    state = load_workspace(self.server.workspace)
                self._json(200, state)
            except (OSError, ValueError, TypeError, KeyError):
                self._json(503, {"error": "Local data could not be read. Try refreshing shortly."})
            return
        if path == "/api/session":
            self._json(200, {"token": self.server.control_token})
            return
        if path == "/api/demo":
            try:
                self._json(200, demo_state())
            except (OSError, ValueError, sqlite3.Error):
                self._json(503, {"error": "The isolated demo could not be prepared."})
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

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path not in {"/api/import", "/api/scan"} or self.server.hermes_home is not None:
            self._read_only()
            return
        expected_origin = f"http://{self.headers.get('Host', '')}"
        if (not self._trusted_request() or self.headers.get("Origin") != expected_origin
                or not hmac.compare_digest(self.headers.get("X-Orbit-Token", ""), self.server.control_token)):
            self._json(403, {"error": "Open this action from your local Orbit OS window."})
            return
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            self._json(415, {"error": "A JSON request is required."})
            return
        raw_length = self.headers.get("Content-Length", "")
        if (not raw_length.isdecimal() or not 0 < int(raw_length) <= MAX_REQUEST_BYTES
                or self.headers.get("Transfer-Encoding") or self.headers.get("Content-Encoding")):
            self._json(413, {"error": "The upload is missing or exceeds 40 MB."})
            return
        if not self.server.begin_control():
            self._json(409, {"error": "Another operation is running. Wait for it to finish."})
            return
        try:
            self.connection.settimeout(15)
            raw = self.rfile.read(int(raw_length))
            if len(raw) != int(raw_length):
                raise ValueError("Incomplete upload.")
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError("Invalid request.")
            if path == "/api/import":
                self._import(payload)
            else:
                self._scan(payload)
        except (ValueError, TypeError, KeyError, RecursionError, InvalidTargetError):
            self._json(400, {"error": "The input could not be imported or used safely. Check the account, capture time, and complete export files."})
        except (OSError, sqlite3.Error):
            self._json(503, {"error": "Local operation failed safely. Check the workspace and try later."})
        finally:
            self.server.control_lock.release()

    def _import(self, payload: dict[str, Any]) -> None:
        from .personal import import_files

        allowed = {"account", "captured_at", "complete_followers", "complete_following", "files"}
        if set(payload) - allowed or not isinstance(payload.get("account"), str):
            raise ValueError("Invalid import fields")
        for flag in ("complete_followers", "complete_following"):
            if type(payload.get(flag, False)) is not bool:
                raise ValueError("Invalid completeness declaration")
        supplied = payload.get("files")
        if not isinstance(supplied, list) or not 1 <= len(supplied) <= 256:
            raise ValueError("Invalid file selection")
        documents: dict[str, bytes] = {}
        for entry in supplied:
            if not isinstance(entry, dict) or set(entry) != {"name", "content"}:
                raise ValueError("Invalid file")
            name, content = entry["name"], entry["content"]
            if not isinstance(name, str) or not isinstance(content, str) or len(name) > 256 or name in documents:
                raise ValueError("Invalid filename")
            documents[name] = base64.b64decode(content, validate=True)
        ensure_workspace(self.server.workspace)
        result = import_files(documents, self.server.workspace, account=payload["account"],
                              captured_at=payload.get("captured_at"),
                              complete_followers=payload.get("complete_followers", False),
                              complete_following=payload.get("complete_following", False))
        self._json(200, {"ok": True, "import_result": result.get("import_result", {})})

    def _scan(self, payload: dict[str, Any]) -> None:
        from orbitdiff.cli import _run_live
        from orbitdiff.providers.base import normalize_target

        if set(payload) - {"target", "login", "baseline"}:
            raise ValueError("Unknown scan fields")
        if not isinstance(payload.get("target"), str) or not isinstance(payload.get("login"), str):
            raise ValueError("A public target and login username are required")
        target, login = normalize_target(payload["target"]), normalize_target(payload["login"])
        if type(payload.get("baseline", False)) is not bool:
            raise ValueError("Invalid baseline selection")
        ensure_workspace(self.server.workspace)
        result = _run_live(argparse.Namespace(target=target, login_username=login,
                                             session_file=None, data_dir=self.server.workspace),
                           baseline=payload.get("baseline", False))
        messages = {0: "Public scan saved. Changes still require two matching complete observations.",
                    2: "Scan stopped. Check the public target and complete session setup in your local terminal.",
                    3: "Scan stopped because of cooldown, incomplete data, or a provider error. Wait at least 30 minutes before another attempt.",
                    4: "The local workspace could not be updated safely."}
        self._json(200, {"ok": result == 0, "exit_code": result,
                         "message": messages.get(result, "Scan did not finish.")})

    do_PUT = _read_only
    do_PATCH = _read_only
    do_DELETE = _read_only
    do_OPTIONS = _read_only
