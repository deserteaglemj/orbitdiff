from __future__ import annotations

import base64
import http.client
import json
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from orbit_os.server import OrbitServer


@pytest.fixture
def portable(tmp_path: Path) -> Iterator[OrbitServer]:
    instance = OrbitServer(("127.0.0.1", 0), workspace=tmp_path / "workspace")
    thread = threading.Thread(target=instance.serve_forever, daemon=True)
    thread.start()
    yield instance
    instance.shutdown()
    instance.server_close()
    thread.join(timeout=2)


def call(server: OrbitServer, path: str, payload: dict[str, Any] | None = None,
         headers: dict[str, str] | None = None) -> tuple[int, dict[str, Any]]:
    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=10)
    try:
        connection.request("POST" if payload is not None else "GET", path,
                           body=json.dumps(payload).encode() if payload is not None else None,
                           headers=headers or {})
        response = connection.getresponse()
        return response.status, json.loads(response.read())
    finally:
        connection.close()


def authorized(server: OrbitServer) -> dict[str, str]:
    status, session = call(server, "/api/session")
    assert status == 200
    return {"Origin": f"http://127.0.0.1:{server.server_port}",
            "Content-Type": "application/json", "X-Orbit-Token": session["token"]}


def test_import_requires_origin_and_unforgeable_local_token(portable: OrbitServer) -> None:
    assert call(portable, "/api/import", {})[0] == 403
    headers = authorized(portable)
    headers["Origin"] = "https://attacker.invalid"
    assert call(portable, "/api/import", {}, headers)[0] == 403
    headers = authorized(portable)
    headers["X-Orbit-Token"] = "wrong"
    assert call(portable, "/api/import", {}, headers)[0] == 403


def test_uploaded_content_imports_without_exposing_arbitrary_paths(portable: OrbitServer) -> None:
    content = json.dumps([{"string_list_data": [{"value": "nova_labs", "timestamp": 1}]}]).encode()
    payload = {"account": "atlas_studio", "captured_at": "2026-09-29T12:00:00Z",
               "complete_followers": True, "complete_following": False,
               "files": [{"name": "followers_1.json", "content": base64.b64encode(content).decode()}]}
    status, result = call(portable, "/api/import", payload, authorized(portable))
    assert status == 200, result
    _, state = call(portable, "/api/state")
    assert state["personal"]["accounts"][0]["username"] == "nova_labs"
    assert state["personal"]["accounts"][0]["following"] is None
    assert call(portable, "/api/import", {"path": "private.json"}, authorized(portable))[0] == 400


def test_demo_never_changes_the_live_workspace(portable: OrbitServer) -> None:
    status, demo = call(portable, "/api/demo")
    assert status == 200
    assert demo["workspace"]["demo"] is True
    _, state = call(portable, "/api/state")
    assert state["personal"]["status"] == "missing"
    assert state["watchlist"] == []


def test_invalid_scan_values_never_invoke_a_collector(portable: OrbitServer) -> None:
    status, _ = call(portable, "/api/scan", {"target": "../private", "login": "atlas_studio"}, authorized(portable))
    assert status == 400
    assert not (portable.workspace / "orbitdiff.sqlite3").exists()
