from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from orbitdiff import cli, paths
from orbitdiff.models import Account, Collection


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
    assert cli.main(["scan", *base_args]) == 0
    assert capsys.readouterr().out == ""  # type: ignore[attr-defined]

    monkeypatch.setattr(cli, "_cooldown_active", lambda *_args: False)  # type: ignore[attr-defined]
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


def test_status_returns_four_for_locked_database(tmp_path: Path, capsys: object) -> None:
    database = tmp_path / "orbitdiff.sqlite3"
    cli._store(tmp_path).initialize()  # type: ignore[attr-defined]
    connection = sqlite3.connect(database, timeout=0)
    connection.execute("BEGIN EXCLUSIVE")
    try:
        assert cli.main(["status", "atlas_studio", "--data-dir", str(tmp_path)]) == 4
    finally:
        connection.rollback()
        connection.close()

    assert "storage failed" in capsys.readouterr().err  # type: ignore[attr-defined]
