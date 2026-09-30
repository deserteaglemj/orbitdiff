from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections.abc import Sequence
from datetime import timedelta
from importlib.metadata import PackageNotFoundError, version
from importlib.resources import files
from pathlib import Path
from tempfile import TemporaryDirectory

from orbitdiff.models import Event
from orbitdiff.paths import database_path, default_data_dir, ensure_private_directory
from orbitdiff.providers.base import (
    CollectionIncompleteError,
    InvalidTargetError,
    PrivateTargetError,
    ProviderError,
    SessionUnavailableError,
    normalize_target,
)
from orbitdiff.providers.fixture import FixtureProvider
from orbitdiff.providers.instaloader import InstaloaderProvider
from orbitdiff.reports import render_json, render_markdown, write_report
from orbitdiff.store import GraphStore

COOLDOWN = timedelta(minutes=30)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="orbitdiff", description="Confirmed public following-list changes.")
    try:
        release = version("orbitdiff")
    except PackageNotFoundError:
        from orbitdiff import __version__

        release = __version__
    parser.add_argument("--version", action="version", version=f"OrbitDiff {release}")
    commands = parser.add_subparsers(dest="command", required=True)

    doctor = commands.add_parser("doctor", help="check local readiness without collecting")
    doctor.add_argument("--data-dir", type=Path)

    for command in ("init", "scan"):
        item = commands.add_parser(command)
        item.add_argument("target")
        item.add_argument("--login", required=True, dest="login_username")
        item.add_argument("--session-file", type=Path)
        item.add_argument("--data-dir", type=Path)

    status = commands.add_parser("status", help="show stored state")
    status.add_argument("target")
    status.add_argument("--data-dir", type=Path)
    status.add_argument("--json", action="store_true")

    targets = commands.add_parser("targets", help="list stored targets without collecting")
    targets.add_argument("--data-dir", type=Path)
    targets.add_argument("--json", action="store_true")

    roster = commands.add_parser("roster", help="read confirmed, observed, and pending relationships")
    roster.add_argument("target")
    roster.add_argument("--data-dir", type=Path)
    roster.add_argument("--json", action="store_true")

    report = commands.add_parser("report", help="render stored confirmed events")
    report.add_argument("target")
    report.add_argument("--data-dir", type=Path)
    report.add_argument("--format", choices=("json", "markdown"), default="markdown")
    report.add_argument("--output", type=Path)

    demo = commands.add_parser("demo", help="run synthetic baseline, pending, and confirmation scans")
    demo.add_argument("--data-dir", type=Path)
    return parser


def _store(data_dir: Path | None) -> GraphStore:
    return GraphStore(database_path(data_dir))


def _make_live_provider(args: argparse.Namespace) -> InstaloaderProvider:
    return InstaloaderProvider(args.login_username, args.session_file)


def _print_events(events: Sequence[Event]) -> None:
    for event in events:
        print(f"{event.event_type} {event.username} ({event.actor_id}) confirmed {event.confirmed_at}")


def _run_live(args: argparse.Namespace, baseline: bool) -> int:
    target = normalize_target(args.target)
    store = _store(args.data_dir)
    if not store.reserve_live_attempt(target, cooldown=COOLDOWN):
        print("scan cooldown active; wait 30 minutes before another live scan", file=sys.stderr)
        return 3
    if baseline and store.status(target)["initialized"]:
        print("target already has a baseline; use an ordinary scan for later observations", file=sys.stderr)
        return 2
    try:
        collection = _make_live_provider(args).collect(target)
        if not collection.complete:
            raise CollectionIncompleteError("collection was not complete")
        events = store.apply_collection(collection, baseline_run=baseline)
    except (InvalidTargetError, PrivateTargetError, SessionUnavailableError) as error:
        store.record_failed_run(target, str(error), baseline_run=baseline)
        print(str(error), file=sys.stderr)
        return 2
    except (CollectionIncompleteError, ProviderError) as error:
        store.record_failed_run(target, str(error), baseline_run=baseline)
        print(str(error), file=sys.stderr)
        return 3
    except OSError:
        print("local storage failed", file=sys.stderr)
        return 4
    if not baseline:
        _print_events(events)
    return 0


def _doctor(data_dir: Path | None) -> int:
    root = data_dir or default_data_dir()
    _store(root).initialize()
    print(f"OrbitDiff doctor: Python {sys.version_info.major}.{sys.version_info.minor}; storage ready at {root}")
    return 0


def _demo(data_dir: Path | None) -> int:
    temporary_parent: str | None = None
    if data_dir is not None:
        ensure_private_directory(data_dir)
        temporary_parent = str(data_dir)
    with TemporaryDirectory(prefix="orbitdiff-demo-", dir=temporary_parent) as temporary_dir:
        store = _store(Path(temporary_dir).resolve())
        target = "atlas_studio"
        fixtures = files("orbitdiff").joinpath("fixtures")
        baseline = FixtureProvider(Path(str(fixtures.joinpath("baseline.json")))).collect(target)
        pending = FixtureProvider(Path(str(fixtures.joinpath("pending.json")))).collect(target)
        confirmed = FixtureProvider(Path(str(fixtures.joinpath("confirmed.json")))).collect(target)
        store.apply_collection(baseline)
        print("baseline stored")
        store.apply_collection(pending)
        print("pending changes observed")
        _print_events(store.apply_collection(confirmed))
    return 0


def _status(args: argparse.Namespace) -> int:
    target = normalize_target(args.target)
    state = _store(args.data_dir).status(target)
    if args.json:
        print(json.dumps(state, sort_keys=True))
    else:
        confirmed = state["confirmed_count"] if state["confirmed_count"] is not None else "unknown"
        pending = state["pending_count"] if state["pending_count"] is not None else "unknown"
        print(f"{target}: {confirmed} confirmed, {pending} pending ({state['observation_status']})")
    return 0


def _report(args: argparse.Namespace) -> int:
    target = normalize_target(args.target)
    events = _store(args.data_dir).events(target)
    content = render_json(target, events) if args.format == "json" else render_markdown(target, events)
    if args.output:
        write_report(args.output, content)
    else:
        print(content, end="")
    return 0


def _targets(args: argparse.Namespace) -> int:
    targets = _store(args.data_dir).targets()
    if args.json:
        print(json.dumps(targets, sort_keys=True))
    else:
        for target in targets:
            confirmed = target["confirmed_count"] if target["confirmed_count"] is not None else "unknown"
            pending = target["pending_count"] if target["pending_count"] is not None else "unknown"
            print(f"{target['target']}: {confirmed} confirmed, {pending} pending ({target['observation_status']})")
    return 0


def _roster(args: argparse.Namespace) -> int:
    target = normalize_target(args.target)
    accounts = _store(args.data_dir).roster(target)
    if args.json:
        print(json.dumps({"target": target, "accounts": accounts}, sort_keys=True))
    else:
        for account in accounts:
            pending = account["pending_present"]
            state = "pending addition" if pending is True else "pending removal" if pending is False else "confirmed present" if account["confirmed_present"] else "confirmed absent"
            print(f"{account['username']} ({account['profile_id']}): {state}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "doctor":
            return _doctor(args.data_dir)
        if args.command == "init":
            return _run_live(args, baseline=True)
        if args.command == "scan":
            return _run_live(args, baseline=False)
        if args.command == "status":
            return _status(args)
        if args.command == "report":
            return _report(args)
        if args.command == "targets":
            return _targets(args)
        if args.command == "roster":
            return _roster(args)
        if args.command == "demo":
            return _demo(args.data_dir)
    except InvalidTargetError as error:
        print(str(error), file=sys.stderr)
        return 2
    except (OSError, sqlite3.Error):
        print("local storage failed", file=sys.stderr)
        return 4
    raise AssertionError(f"unknown command: {args.command}")
