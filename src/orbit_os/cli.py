"""Portable, agent-friendly commands for the Orbit OS workspace."""

from __future__ import annotations

import argparse
import importlib
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

from orbitdiff.providers.base import InvalidTargetError

from . import __version__
from .workspace import default_workspace, demo_state, ensure_workspace, load_workspace


def _json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=True, allow_nan=False, sort_keys=True))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="orbit-os", description="Your private local relationship workspace.")
    parser.add_argument("--version", action="version", version=f"Orbit OS {__version__}")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("doctor", "relationships", "targets", "status", "report", "demo", "import", "scan", "app"):
        command = commands.add_parser(name)
        command.add_argument("--workspace", type=Path, default=None)
        if name in {"relationships", "targets", "status", "doctor"}:
            command.add_argument("--json", action="store_true", help="JSON is the default output")
        if name == "import":
            command.add_argument("source", type=Path)
            command.add_argument("--account", required=True)
            command.add_argument("--captured-at", help="Actual export capture time with timezone, if known")
            command.add_argument("--complete-followers", action="store_true")
            command.add_argument("--complete-following", action="store_true")
        if name == "scan":
            command.add_argument("target")
            command.add_argument("--login", required=True)
            command.add_argument("--baseline", action="store_true")
        if name == "report":
            command.add_argument("--format", choices=("json", "markdown"), default="markdown")
        if name == "app":
            command.add_argument("--port", type=int, default=8767)
            command.add_argument("--open", action="store_true")
            command.add_argument("--desktop", action="store_true")
            command.add_argument("--hermes-home", type=Path)
    login = commands.add_parser("login", help="human-operated session setup in a local terminal")
    login.add_argument("username")
    commands.add_parser("alerts", help="opt-in daily following alerts and notification status")
    return parser


def _login(username: str) -> int:
    from orbitdiff.providers.base import normalize_target

    username = normalize_target(username)
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        print("Run this command yourself in a local terminal. Do not send credentials to an agent.", file=sys.stderr)
        return 2
    provider_command = importlib.import_module("instaloader.__main__")

    previous = sys.argv
    try:
        sys.argv = ["instaloader", "--login", username]
        provider_command.main()
    finally:
        sys.argv = previous
    return 0


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if arguments and arguments[0] == "alerts":
        from .alerts_cli import main as alerts_main
        return alerts_main(arguments[1:])
    if not arguments or (arguments[0].startswith("-") and arguments[0] not in {"--version", "--help", "-h"}):
        arguments.insert(0, "app")
    parser = _parser()
    args = parser.parse_args(arguments)
    try:
        if args.command == "login":
            return _login(args.username)
        workspace = args.workspace or default_workspace()
        if args.command == "app":
            if args.hermes_home is not None and args.workspace is not None:
                parser.error("choose --workspace or --hermes-home, not both")
            if args.desktop:
                from .desktop import launch
                return launch(workspace=None if args.hermes_home else workspace, hermes_home=args.hermes_home)
            from .__main__ import serve
            return serve(port=args.port, open_browser=args.open, workspace=args.workspace, hermes_home=args.hermes_home)
        if args.command == "demo":
            _json(demo_state())
            return 0
        if args.command == "doctor":
            ensure_workspace(workspace)
        if args.command == "import":
            from .personal import import_export
            ensure_workspace(workspace)
            _json(import_export(args.source, workspace, account=args.account,
                               captured_at=args.captured_at, complete_followers=args.complete_followers,
                               complete_following=args.complete_following))
            return 0
        if args.command == "scan":
            from orbitdiff.cli import main as collect
            ensure_workspace(workspace)
            return collect(["init" if args.baseline else "scan", args.target,
                            "--login", args.login, "--data-dir", str(workspace)])
        state = load_workspace(workspace)
        if args.command == "doctor":
            _json({"app": "orbit-os", "version": __version__, "ready": not state["issues"],
                   "workspace": str(workspace), "personal_status": state["personal"]["status"],
                   "watchlist_count": len(state["watchlist"]), "issues": state["issues"]})
            return 4 if state["issues"] else 0
        elif args.command == "relationships":
            _json(state["personal"])
        elif args.command == "targets":
            _json(state["watchlist"])
        elif args.command == "report" and args.format == "markdown":
            personal = state["personal"]
            print(f"# Orbit OS relationship report\n\nPersonal source: {personal.get('source', 'unavailable')}.")
            print(f"Capture time: {personal.get('last_success_at') or 'unknown'}.")
            print("\nPersonal export differences are observations, not live confirmations.")
            for event in personal["events"]:
                print(f"- {event['type']}: {event.get('username') or 'unknown'} ({event.get('ts') or 'unknown date'})")
            for watch in state["watchlist"]:
                print(f"\n## Public watchlist: {watch['username']}\n")
                for event in watch["events"]:
                    print(f"- {event['type']}: {event.get('username') or 'unknown'} ({event.get('ts') or 'unknown date'})")
        else:
            _json(state)
        return 0
    except (ValueError, InvalidTargetError) as error:
        print(str(error), file=sys.stderr)
        return 2
    except (OSError, sqlite3.Error):
        print("Local workspace could not be read or written safely.", file=sys.stderr)
        return 4
