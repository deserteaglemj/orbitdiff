"""Explicit local lifecycle for an agent-host daily alert job."""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from orbitdiff.alert_delivery import MacOSSender
from orbitdiff.alert_outbox import OutboxStore
from orbitdiff.alerts import deliver_job, run_job
from orbitdiff.paths import validate_local_path
from orbitdiff.providers.instaloader import InstaloaderProvider


def probe_runtime(path: Path) -> str:
    validate_local_path(path)
    if not path.is_absolute() or not path.is_file():
        raise ValueError("choose an existing absolute orbit-os executable")
    try:
        version = subprocess.run([str(path), "--version"], capture_output=True, text=True,
                                 timeout=10, check=False)
        help_result = subprocess.run([str(path), "alerts", "--help"], capture_output=True,
                                     text=True, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError("runtime capability probe failed") from error
    match = re.fullmatch(r"Orbit OS (0\.2\.\d+)\s*", version.stdout)
    if (version.returncode or help_result.returncode or match is None
            or any(word not in help_result.stdout for word in ("setup", "dry-run", "deliver", "run"))):
        raise ValueError("runtime lacks the supported daily alert commands")
    return match[1]


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="orbit-os alerts", description="Opt-in daily following alerts; host scheduling is separate.")
    actions = parser.add_subparsers(dest="action", required=True)
    for name in ("setup", "status", "bind", "enable", "pause", "resume", "update", "remove",
                 "dry-run", "run", "deliver", "resolve", "test-notification"):
        action = actions.add_parser(name)
        action.add_argument("--workspace", type=Path, required=True)
        if name == "setup":
            action.add_argument("target")
            action.add_argument("--login", required=True)
            action.add_argument("--session-file", type=Path)
            action.add_argument("--runtime", type=Path, required=True)
            action.add_argument("--at", required=True)
            action.add_argument("--timezone", required=True)
            action.add_argument("--host", choices=("codex",), default="codex")
            action.add_argument("--channel", choices=("macos",), default="macos")
            action.add_argument("--destination", choices=("current-user",), required=True)
        elif name == "status":
            action.add_argument("job", nargs="?")
        elif name == "test-notification":
            action.add_argument("--confirm-local-notification", action="store_true")
        elif name == "resolve":
            action.add_argument("notice")
            action.add_argument("--action", dest="resolution", choices=("retry", "discard"), required=True)
            action.add_argument("--accept-duplicate-risk", action="store_true")
        else:
            action.add_argument("job")
            if name == "bind":
                action.add_argument("--host-job-id", required=True)
            if name == "update":
                action.add_argument("--at", required=True)
                action.add_argument("--timezone", required=True)
                action.add_argument("--runtime", type=Path)
                action.add_argument("--login")
                action.add_argument("--session-file", type=Path)
    return parser


def _execute(args: argparse.Namespace, now: datetime) -> dict[str, Any]:
    workspace = validate_local_path(args.workspace)
    store = OutboxStore(workspace / "orbitdiff.sqlite3")
    if args.action == "status":
        jobs = store.jobs(now=now)
        if args.job:
            jobs = [job for job in jobs if job["id"] == args.job]
            if not jobs:
                raise ValueError("alert job was not found")
        return {"outcome": "success", "jobs": jobs,
                "notices": store.notices(args.job) if args.job else [],
                "delivery_attempts": store.delivery_attempts(args.job) if args.job else []}
    if args.action == "test-notification":
        if not args.confirm_local_notification:
            raise ValueError("select --confirm-local-notification to submit a synthetic local notification")
        submission = MacOSSender().send("Synthetic OrbitDiff notification test. No Instagram data was collected.", "synthetic")
        return {"outcome": "success" if submission.state == "accepted" else "partial",
                "synthetic": True, "submission": submission.state, "detail": submission.detail,
                "display_verified": False, "read_verified": False}
    if args.action == "setup":
        if sys.platform != "darwin":
            raise ValueError("the initial notification route requires macOS")
        version = probe_runtime(args.runtime)
        result = store.configure(args.target, login=args.login, runtime=args.runtime,
                                 session_file=args.session_file, time=args.at, timezone=args.timezone, now=now)
        return {"outcome": "success", "job": result, "runtime_version": version,
                "host_action": "register_with_supported_host_tool", "automatically_running": False}
    if args.action == "resolve":
        if args.resolution == "retry" and not args.accept_duplicate_risk:
            raise ValueError("retry requires --accept-duplicate-risk; the original may have appeared")
        store.resolve(args.notice, action=args.resolution, now=now)
        return {"outcome": "success", "notice_id": args.notice, "resolution": args.resolution}
    job = store.job(args.job)
    if args.action == "dry-run":
        return {"outcome": "success", "job": next(r for r in store.jobs(now=now) if r["id"] == args.job),
                "would_contact_instagram": False, "would_send_notifications": False,
                "host_registration_verified": False}
    if args.action in {"run", "deliver"}:
        runtime = Path(sys.argv[0]).absolute()
        if str(runtime) != job["runtime"]:
            return {"outcome": "blocked", "reason": "runtime_mismatch"}
        if args.action == "deliver":
            return deliver_job(store, args.job, now=now, sender=MacOSSender())
        return run_job(store, args.job, now=now, runtime=runtime, sender=MacOSSender(),
                       provider_factory=lambda: InstaloaderProvider(job["login"],
                           Path(job["session_file"]) if job["session_file"] else None))
    if args.action == "bind":
        store.bind(args.job, args.host_job_id)
    elif args.action in {"enable", "resume"}:
        if sys.platform != "darwin":
            raise ValueError("the initial notification route requires macOS")
        if str(Path(sys.argv[0]).absolute()) != job["runtime"]:
            return {"outcome": "blocked", "reason": "runtime_mismatch"}
        store.enable(args.job, now=now)
    elif args.action == "pause":
        store.pause(args.job)
    elif args.action == "remove":
        store.remove(args.job)
    elif args.action == "update":
        if args.runtime is not None:
            probe_runtime(args.runtime)
        store.update(args.job, time=args.at, timezone=args.timezone, now=now,
                     runtime=args.runtime, login=args.login, session_file=args.session_file)
    result = {"outcome": "success", "job": next(r for r in store.jobs(now=now) if r["id"] == args.job)}
    host_actions = {"pause": "pause_matching_host_job", "remove": "remove_matching_host_job",
                    "update": "update_and_rebind_matching_host_job", "resume": "resume_matching_host_job"}
    if args.action in host_actions:
        result["host_action"] = host_actions[args.action]
    return result


def main(argv: list[str]) -> int:
    args = _parser().parse_args(argv)
    try:
        result = _execute(args, datetime.now(UTC))
    except ValueError as error:
        result = {"outcome": "blocked", "reason": str(error)}
    except (OSError, sqlite3.Error):
        result = {"outcome": "error", "reason": "local workspace could not be read or written safely"}
    print(json.dumps(result, sort_keys=True, ensure_ascii=True))
    return {"success": 0, "no_work": 0, "partial": 3, "blocked": 2, "error": 4}[result["outcome"]]
