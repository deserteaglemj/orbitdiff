from __future__ import annotations

import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event

import pytest

from orbitdiff import cli, paths
from orbitdiff.models import Account, Collection
from orbitdiff.providers.base import ProviderError


class SequenceProvider:
    def __init__(self, collections: list[Collection]) -> None:
        self.collections = collections

    def collect(self, _target: str) -> Collection:
        return self.collections.pop(0)


def collection(accounts: dict[str, str]) -> Collection:
    return Collection(
        target="atlas_studio",
        reported_count=len(accounts),
        accounts=tuple(Account(profile_id=profile_id, username=username) for profile_id, username in accounts.items()),
        complete=True,
        collected_at=datetime.now(UTC),
    )


def test_demo_runs_offline_through_baseline_pending_and_confirmed_states(
    tmp_path: Path, capsys: object
) -> None:
    assert cli.main(["demo", "--data-dir", str(tmp_path)]) == 0

    output = capsys.readouterr().out  # type: ignore[attr-defined]
    assert "baseline" in output.lower()
    assert "pending" in output.lower()
    assert "following_started" in output


def test_demo_uses_ephemeral_storage_without_touching_default_database(
    tmp_path: Path, monkeypatch: object
) -> None:
    default_dir = tmp_path / "default"
    default_dir.mkdir()
    database = default_dir / "orbitdiff.sqlite3"
    original = b"preserved default database"
    database.write_bytes(original)
    monkeypatch.setattr(paths, "default_data_dir", lambda: default_dir)  # type: ignore[attr-defined]

    assert cli.main(["demo"]) == 0

    assert database.read_bytes() == original
    assert list(default_dir.iterdir()) == [database]


def test_demo_uses_cleaned_temporary_child_for_explicit_parent(tmp_path: Path, capsys: object) -> None:
    database = tmp_path / "orbitdiff.sqlite3"
    original = b"fixed-name collision must remain untouched"
    database.write_bytes(original)

    assert cli.main(["demo", "--data-dir", str(tmp_path)]) == 0
    assert cli.main(["demo", "--data-dir", str(tmp_path)]) == 0

    output = capsys.readouterr().out  # type: ignore[attr-defined]
    assert output.count("baseline stored") == 2
    assert output.count("following_started") == 2
    assert database.read_bytes() == original
    assert list(tmp_path.iterdir()) == [database]


def test_init_is_silent_and_scan_prints_only_confirmed_changes(
    tmp_path: Path, monkeypatch: object, capsys: object
) -> None:
    provider = SequenceProvider(
        [
            collection({"1": "pixel_forge"}),
            collection({"2": "nova_labs"}),
            collection({"2": "nova_labs"}),
        ]
    )
    monkeypatch.setattr(cli, "_make_live_provider", lambda _args: provider)  # type: ignore[attr-defined]
    base_args = ["atlas_studio", "--login", "analyst", "--data-dir", str(tmp_path)]

    assert cli.main(["init", *base_args]) == 0
    assert capsys.readouterr().out == ""  # type: ignore[attr-defined]
    monkeypatch.setattr(cli, "COOLDOWN", timedelta(0))  # type: ignore[attr-defined]
    assert cli.main(["scan", *base_args]) == 0
    assert capsys.readouterr().out == ""  # type: ignore[attr-defined]

    assert cli.main(["scan", *base_args]) == 0
    assert "following_started" in capsys.readouterr().out  # type: ignore[attr-defined]


def test_live_scan_cooldown_blocks_second_scan_without_collecting_again(
    tmp_path: Path, monkeypatch: object, capsys: object
) -> None:
    provider = SequenceProvider([collection({"1": "pixel_forge"})])
    monkeypatch.setattr(cli, "_make_live_provider", lambda _args: provider)  # type: ignore[attr-defined]
    args = ["scan", "atlas_studio", "--login", "analyst", "--data-dir", str(tmp_path)]

    assert cli.main(args) == 0
    assert cli.main(args) == 3
    assert "cooldown" in capsys.readouterr().err.lower()  # type: ignore[attr-defined]
    assert len(provider.collections) == 0


def test_status_json_and_report_file_are_stored_output_only(
    tmp_path: Path, monkeypatch: object, capsys: object
) -> None:
    provider = SequenceProvider([collection({"1": "pixel_forge"})])
    monkeypatch.setattr(cli, "_make_live_provider", lambda _args: provider)  # type: ignore[attr-defined]
    common = ["atlas_studio", "--login", "analyst", "--data-dir", str(tmp_path)]
    assert cli.main(["init", *common]) == 0
    capsys.readouterr()  # type: ignore[attr-defined]

    assert cli.main(["status", "atlas_studio", "--data-dir", str(tmp_path), "--json"]) == 0
    status = json.loads(capsys.readouterr().out)  # type: ignore[attr-defined]
    assert status["confirmed_count"] == 1

    output = tmp_path / "report.md"
    assert cli.main(["report", "atlas_studio", "--data-dir", str(tmp_path), "--output", str(output)]) == 0
    assert "OrbitDiff report" in output.read_text()


def test_storage_errors_return_redacted_exit_code_four(
    tmp_path: Path, monkeypatch: object, capsys: object
) -> None:
    database = tmp_path / "orbitdiff.sqlite3"
    database.write_bytes(b"not a SQLite database")
    live_args = ["atlas_studio", "--login", "analyst", "--data-dir", str(tmp_path)]
    provider = SequenceProvider([collection({"1": "pixel_forge"})])
    monkeypatch.setattr(cli, "_make_live_provider", lambda _args: provider)  # type: ignore[attr-defined]

    assert cli.main(["doctor", "--data-dir", str(tmp_path)]) == 4
    assert cli.main(["status", "atlas_studio", "--data-dir", str(tmp_path)]) == 4
    assert cli.main(["report", "atlas_studio", "--data-dir", str(tmp_path)]) == 4
    assert cli.main(["init", *live_args]) == 4
    assert cli.main(["scan", *live_args]) == 4

    errors = capsys.readouterr().err  # type: ignore[attr-defined]
    assert "storage failed" in errors
    assert "orbitdiff.sqlite3" not in errors
    assert "traceback" not in errors.lower()
    assert database.read_bytes() == b"not a SQLite database"


def test_demo_and_report_write_failures_return_redacted_exit_code_four(
    tmp_path: Path, monkeypatch: object, capsys: object
) -> None:
    def fail_temporary_directory(**_kwargs: object) -> object:
        raise OSError("/private/demo path")

    monkeypatch.setattr(cli, "TemporaryDirectory", fail_temporary_directory)  # type: ignore[attr-defined]
    assert cli.main(["demo"]) == 4

    monkeypatch.undo()
    cli._store(tmp_path).initialize()  # type: ignore[attr-defined]

    def fail_report_write(_path: Path, _content: str) -> None:
        raise OSError("/private/report path")

    monkeypatch.setattr(cli, "write_report", fail_report_write)  # type: ignore[attr-defined]
    assert cli.main(["report", "atlas_studio", "--data-dir", str(tmp_path), "--output", str(tmp_path / "report.md")]) == 4

    errors = capsys.readouterr().err  # type: ignore[attr-defined]
    assert "storage failed" in errors
    assert "/private" not in errors


def test_status_reads_committed_snapshot_during_writer_lock(tmp_path: Path, capsys: object) -> None:
    database = tmp_path / "orbitdiff.sqlite3"
    cli._store(tmp_path).initialize()  # type: ignore[attr-defined]
    connection = sqlite3.connect(database, timeout=0)
    connection.execute("BEGIN EXCLUSIVE")
    try:
        assert cli.main(["status", "atlas_studio", "--data-dir", str(tmp_path), "--json"]) == 0
    finally:
        connection.rollback()
        connection.close()

    output = capsys.readouterr()  # type: ignore[attr-defined]
    assert output.err == ""
    assert json.loads(output.out)["confirmed_count"] is None


def test_uninitialized_status_text_preserves_unknown_counts(tmp_path: Path, capsys: object) -> None:
    cli._store(tmp_path).record_failed_run("atlas_studio", "session unavailable")
    assert cli.main(["status", "atlas_studio", "--data-dir", str(tmp_path)]) == 0
    output = capsys.readouterr().out  # type: ignore[attr-defined]
    assert "unknown confirmed" in output
    assert "failed" in output


def test_reinitializing_an_existing_target_never_collects_or_advances_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    store = cli._store(tmp_path)
    previous = collection({"1": "pixel_forge"})
    previous = Collection(target=previous.target, reported_count=1, accounts=previous.accounts,
                          complete=True, collected_at=datetime.now(UTC) - timedelta(hours=1))
    store.apply_collection(previous, baseline_run=True)

    def forbidden_provider(_args: object) -> None:
        pytest.fail("An existing baseline must not collect again through init")

    monkeypatch.setattr(cli, "_make_live_provider", forbidden_provider)
    assert cli.main(["init", "atlas_studio", "--login", "analyst", "--data-dir", str(tmp_path)]) == 2
    assert "already" in capsys.readouterr().err
    assert store.events("atlas_studio") == []
    assert store.status("atlas_studio")["confirmed_count"] == 1


@pytest.mark.parametrize("first,second", [("init", "init"), ("init", "scan"), ("scan", "init")])
def test_initialization_and_scan_share_cooldown_before_provider_creation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, first: str, second: str
) -> None:
    calls: list[str] = []

    def provider(_args: object) -> SequenceProvider:
        calls.append("created")
        return SequenceProvider([collection({"1": "pixel_forge"})])

    monkeypatch.setattr(cli, "_make_live_provider", provider)
    common = ["atlas_studio", "--login", "analyst", "--data-dir", str(tmp_path)]
    assert cli.main([first, *common]) == 0
    assert cli.main([second, *common]) == 3
    assert calls == ["created"]


def test_failed_live_attempt_keeps_cooldown_and_relationship_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    baseline = collection({"1": "pixel_forge"})
    baseline = Collection(
        target=baseline.target, reported_count=1, accounts=baseline.accounts, complete=True,
        collected_at=datetime.now(UTC) - timedelta(hours=1),
    )
    store = cli._store(tmp_path)
    store.apply_collection(baseline)
    calls: list[str] = []

    class FailingProvider:
        def collect(self, _target: str) -> Collection:
            calls.append("collected")
            raise ProviderError("public following collection failed")

    monkeypatch.setattr(cli, "_make_live_provider", lambda _args: FailingProvider())
    common = ["atlas_studio", "--login", "analyst", "--data-dir", str(tmp_path)]
    assert cli.main(["scan", *common]) == 3
    assert cli.main(["init", *common]) == 3
    assert calls == ["collected"]
    assert "cooldown" in capsys.readouterr().err
    assert store.status("atlas_studio")["confirmed_count"] == 1
    assert store.status("atlas_studio")["pending_count"] == 0
    assert store.events("atlas_studio") == []


def test_targets_roster_and_version_are_discoverable_without_collection(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    store = cli._store(tmp_path)
    store.apply_collection(collection({"1": "pixel_forge"}))
    assert cli.main(["targets", "--data-dir", str(tmp_path), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)[0]["target"] == "atlas_studio"
    assert cli.main(["roster", "atlas_studio", "--data-dir", str(tmp_path), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["target"] == "atlas_studio"
    assert payload["accounts"][0]["username"] == "pixel_forge"
    with pytest.raises(SystemExit) as result:
        cli.main(["--version"])
    assert result.value.code == 0
    assert capsys.readouterr().out.startswith("OrbitDiff ")


def test_second_live_command_cannot_collect_while_first_is_in_flight(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    started, release = Event(), Event()
    calls: list[str] = []

    class WaitingProvider:
        def collect(self, _target: str) -> Collection:
            calls.append("collect")
            started.set()
            assert release.wait(timeout=5)
            return collection({"1": "pixel_forge"})

    monkeypatch.setattr(cli, "_make_live_provider", lambda _args: WaitingProvider())
    common = ["atlas_studio", "--login", "analyst", "--data-dir", str(tmp_path)]
    with ThreadPoolExecutor(max_workers=1) as executor:
        first = executor.submit(cli.main, ["init", *common])
        try:
            assert started.wait(timeout=5)
            assert cli.main(["scan", *common]) == 3
        finally:
            release.set()
        assert first.result(timeout=5) == 0
    assert calls == ["collect"]
