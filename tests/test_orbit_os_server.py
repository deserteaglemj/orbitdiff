from __future__ import annotations

import http.client
import json
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest

from orbit_os.server import OrbitServer


@pytest.fixture
def server(tmp_path: Path) -> Iterator[OrbitServer]:
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><title>Orbit OS</title>")
    (web / "app.js").write_text("'use strict';")
    (web / "secret.txt").write_text("must not be served")
    instance = OrbitServer(("127.0.0.1", 0), hermes_home=tmp_path, web_root=web)
    thread = threading.Thread(target=instance.serve_forever, daemon=True)
    thread.start()
    yield instance
    instance.shutdown()
    instance.server_close()
    thread.join(timeout=2)


def request(
    server: OrbitServer,
    path: str,
    method: str = "GET",
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
    try:
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        connection.close()


def test_serves_only_packaged_assets_with_private_security_headers(server: OrbitServer) -> None:
    status, headers, body = request(server, "/")
    assert status == 200 and b"Orbit OS" in body
    assert headers["Cache-Control"] == "no-store"
    assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Referrer-Policy"] == "no-referrer"
    for path in ("/secret.txt", "/../pyproject.toml", "/%2e%2e/pyproject.toml", "/.env"):
        assert request(server, path)[0] == 404


def test_state_missing_sources_is_explicit_and_health_identifies_app(server: OrbitServer) -> None:
    status, _, body = request(server, "/api/state")
    data = json.loads(body)
    assert status == 200
    assert data["schema_version"] == 1
    assert data["personal"]["status"] == "missing"
    assert data["personal"]["metrics"]["followers"] is None
    assert json.loads(request(server, "/api/health")[2])["app"] == "orbit-os"


@pytest.mark.parametrize("headers", [
    {"Host": "attacker.invalid"},
    {"Host": "localhost.attacker.invalid"},
    {"Origin": "https://attacker.invalid"},
    {"Origin": "null"},
    {"Sec-Fetch-Site": "cross-site"},
])
def test_rejects_cross_origin_and_dns_rebinding(
    server: OrbitServer, headers: dict[str, str]
) -> None:
    status, _, body = request(server, "/api/state", headers=headers)
    assert status == 403
    assert b"personal" not in body


def test_read_only_api_rejects_mutations(server: OrbitServer) -> None:
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        assert request(server, "/api/state", method=method)[0] == 405


def test_head_has_no_response_body(server: OrbitServer) -> None:
    status, _, body = request(server, "/", method="HEAD")
    assert status == 200 and body == b""


def test_refuses_non_loopback_bind(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="loopback"):
        OrbitServer(("0.0.0.0", 0), hermes_home=tmp_path)
