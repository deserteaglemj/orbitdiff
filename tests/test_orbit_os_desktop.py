from __future__ import annotations

import base64
import http.client
import json
import runpy
import sys
import threading
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from orbit_os import desktop
from orbit_os import personal as personal_module
from orbit_os.server import OrbitServer


class FakeServer:
    def __init__(self) -> None:
        self.server_port = 49123
        self.stop = threading.Event()
        self.started = threading.Event()
        self.closed = False
        self.thread: threading.Thread | None = None

    def serve_forever(self, *, poll_interval: float) -> None:
        self.thread = threading.current_thread()
        self.started.set()
        self.stop.wait(2)

    def shutdown(self) -> None:
        self.stop.set()

    def server_close(self) -> None:
        self.closed = True


def wire_desktop(monkeypatch: pytest.MonkeyPatch) -> tuple[FakeServer, dict[str, Any]]:
    server = FakeServer()
    calls: dict[str, Any] = {}

    def make_server(address: tuple[str, int], **kwargs: Any) -> FakeServer:
        calls["address"] = address
        calls["server"] = kwargs
        return server

    def create_window(title: str, url: str, **kwargs: Any) -> None:
        calls["window"] = (title, url, kwargs)

    def start(**kwargs: Any) -> None:
        assert server.started.wait(1)
        calls["start"] = kwargs

    fake_webview = SimpleNamespace(settings={}, create_window=create_window, start=start)
    monkeypatch.setattr(desktop, "OrbitServer", make_server)
    monkeypatch.setattr(desktop, "_load_webview", lambda: fake_webview)
    return server, calls


def test_window_owns_loopback_server_and_stops_on_close(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    server, calls = wire_desktop(monkeypatch)
    assert desktop.launch(workspace=tmp_path) == 0
    assert calls["address"] == ("127.0.0.1", 0)
    assert calls["server"] == {"workspace": tmp_path, "hermes_home": None}
    assert calls["window"][1] == "http://127.0.0.1:49123"
    assert calls["start"]["private_mode"] is True
    assert calls["start"]["debug"] is False
    assert server.closed and server.stop.is_set()
    assert server.thread is not None and not server.thread.daemon
    assert not server.thread.is_alive()


def test_compatibility_source_is_explicit_and_does_not_choose_a_workspace(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _, calls = wire_desktop(monkeypatch)
    assert desktop.launch(hermes_home=tmp_path) == 0
    assert calls["server"] == {"workspace": None, "hermes_home": tmp_path}


def test_missing_webview_does_not_start_a_server(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def missing() -> Any:
        raise ImportError("missing optional dependency")

    monkeypatch.setattr(desktop, "_load_webview", missing)
    monkeypatch.setattr(desktop, "OrbitServer", lambda *args, **kwargs: pytest.fail("server started"))
    assert desktop.launch() == 1
    assert "desktop" in capsys.readouterr().err.lower()


def test_gui_failure_still_closes_and_joins_server(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    server, _ = wire_desktop(monkeypatch)

    def fail_window(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("native backend failed")

    monkeypatch.setattr(desktop._load_webview(), "create_window", fail_window)
    assert desktop.launch(workspace=tmp_path) == 1
    assert server.closed and server.stop.is_set()
    assert server.thread is not None and not server.thread.is_alive()


def test_modes_are_mutually_exclusive(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(desktop, "OrbitServer", lambda *args, **kwargs: pytest.fail("server started"))
    assert desktop.launch(workspace=tmp_path, hermes_home=tmp_path) == 1


def test_frozen_entrypoint_routes_cli_without_starting_gui(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []
    fake_cli = SimpleNamespace(main=lambda args: calls.append(args) or 7)
    monkeypatch.setitem(sys.modules, "orbit_os.cli", fake_cli)
    entry = runpy.run_path(str(Path(__file__).parents[1] / "packaging" / "desktop_entry.py"))
    assert entry["main"](["--version"]) == 7
    assert calls == [["--version"]]


def test_frozen_entrypoint_defaults_to_native_window(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[bool] = []
    monkeypatch.setattr(desktop, "launch", lambda: calls.append(True) or 0)
    entry = runpy.run_path(str(Path(__file__).parents[1] / "packaging" / "desktop_entry.py"))
    assert entry["main"]([]) == 0
    assert calls == [True]


def test_native_close_waits_for_admitted_import_to_finish(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    write_entered = threading.Event()
    release_write = threading.Event()
    close_entered = threading.Event()
    launch_finished = threading.Event()
    request_threads: list[threading.Thread] = []
    servers: list[OrbitServer] = []
    responses: list[int] = []
    results: list[int] = []
    errors: list[Exception] = []
    original_write = personal_module._write_state

    def paused_write(path: Path, payload: bytes) -> None:
        write_entered.set()
        assert release_write.wait(5), "test did not release the paused import"
        original_write(path, payload)

    class RecordingServer(OrbitServer):
        def server_close(self) -> None:
            close_entered.set()
            super().server_close()

    def make_server(address: tuple[str, int], **kwargs: Any) -> OrbitServer:
        instance = RecordingServer(address, **kwargs)
        servers.append(instance)
        return instance

    def upload() -> None:
        instance = servers[0]
        connection = http.client.HTTPConnection("127.0.0.1", instance.server_port, timeout=5)
        content = json.dumps([{"string_list_data": [{"value": "nova_labs", "timestamp": 1}]}]).encode()
        payload = {"account": "atlas_studio", "files": [
            {"name": "followers_1.json", "content": base64.b64encode(content).decode()},
        ]}
        try:
            connection.request("POST", "/api/import", json.dumps(payload), headers={
                "Content-Type": "application/json", "X-Orbit-Token": instance.control_token,
                "Origin": f"http://127.0.0.1:{instance.server_port}",
            })
            response = connection.getresponse()
            responses.append(response.status)
            response.read()
        except Exception as error:
            errors.append(error)
        finally:
            connection.close()

    def close_window(**kwargs: Any) -> None:
        requester = threading.Thread(target=upload)
        request_threads.append(requester)
        requester.start()
        assert write_entered.wait(2), "import did not reach its atomic write"

    def run_desktop() -> None:
        try:
            results.append(desktop.launch(workspace=tmp_path / "workspace"))
        finally:
            launch_finished.set()

    monkeypatch.setattr(personal_module, "_write_state", paused_write)
    monkeypatch.setattr(desktop, "OrbitServer", make_server)
    monkeypatch.setattr(desktop, "_load_webview", lambda: SimpleNamespace(
        settings={}, create_window=lambda *args, **kwargs: None, start=close_window,
    ))
    worker = threading.Thread(target=run_desktop)
    worker.start()
    try:
        assert close_entered.wait(3), "desktop did not begin shutdown"
        assert not launch_finished.wait(0.15), "desktop exited while its import was unfinished"
    finally:
        release_write.set()
        worker.join(timeout=5)
        for requester in request_threads:
            requester.join(timeout=5)
    assert not worker.is_alive()
    assert errors == [] and responses == [200] and results == [0]
    state = personal_module.load_personal(tmp_path / "workspace")
    assert state["accounts"][0]["username"] == "nova_labs"
