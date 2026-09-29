from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from orbit_os.__main__ import _existing_app
from orbit_os.server import OrbitServer


def test_occupied_port_probe_never_follows_redirects() -> None:
    requests: list[str] = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            pass

        def do_GET(self) -> None:
            requests.append(self.path)
            if self.path == "/api/health":
                self.send_response(302)
                self.send_header("Location", "/redirected")
                self.end_headers()
            else:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"app":"orbit-os"}')

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        assert not _existing_app(f"http://127.0.0.1:{server.server_port}")
        assert requests == ["/api/health"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.mark.parametrize("custom_source", [False, True])
def test_only_reuses_the_default_workspace(tmp_path: Path, custom_source: bool) -> None:
    server = OrbitServer(("127.0.0.1", 0), hermes_home=tmp_path if custom_source else None)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        assert _existing_app(f"http://127.0.0.1:{server.server_port}") is not custom_source
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
