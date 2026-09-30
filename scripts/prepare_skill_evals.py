"""Prepare isolated synthetic inputs for paired OrbitDiff skill evaluations."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parents[1]


def _write(path: Path, content: str, *, executable: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(0o700 if executable else 0o600)


def _json(path: Path, value: Any) -> None:
    _write(path, json.dumps(value, indent=2, sort_keys=True) + "\n")


def _safe_output(path: Path) -> Path:
    path = path.absolute()
    for component in (path, *path.parents):
        if component.is_symlink():
            raise ValueError("evaluation output must not use symbolic links")
        if component.name == ".ssh" or component.name == ".env" or component.name.startswith(".env."):
            raise ValueError("protected evaluation output path")
    if path.exists() and (not path.is_dir() or any(path.iterdir())):
        raise ValueError("choose a new or empty evaluation output directory")
    return path


def _launcher(path: Path, module: str, source_root: Path) -> None:
    executable = Path(sys.executable).resolve()
    if any(value in str(executable) for value in (" ", "\n")):
        raise ValueError("fixture launcher requires a Python executable path without spaces")
    _write(path, f"#!{executable}\nimport sys\nsys.path.insert(0, {str(source_root / 'src')!r})\n"
           f"from {module} import main\nraise SystemExit(main())\n", executable=True)


def _export(directory: Path, followers: list[str], following: list[str]) -> None:
    def rows(usernames: list[str]) -> list[dict[str, Any]]:
        return [{"string_list_data": [{"value": username, "timestamp": 1}]} for username in usernames]
    _json(directory / "followers_1.json", rows(followers))
    _json(directory / "following.json", {"relationships_following": rows(following)})


def _public_workspace(directory: Path, *, failed: bool, now: datetime) -> None:
    from orbitdiff.models import Account, Collection
    from orbitdiff.store import GraphStore

    store = GraphStore(directory / "orbitdiff.sqlite3")
    store.apply_collection(Collection(
        target="atlas_studio", reported_count=1, accounts=(Account("1", "pixel_forge"),),
        complete=True, collected_at=now - timedelta(minutes=70),
    ), baseline_run=True)
    store.apply_collection(Collection(
        target="atlas_studio", reported_count=0, accounts=(),
        complete=True, collected_at=now - timedelta(minutes=40),
    ))
    if failed:
        store.record_failed_run("atlas_studio", "public following collection failed")
        with sqlite3.connect(store.path) as connection:
            connection.execute(
                "UPDATE runs SET collected_at = ? WHERE state = 'failed'",
                ((now - timedelta(minutes=5)).isoformat(),),
            )
    with sqlite3.connect(store.path) as connection:
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")


def _readonly(directory: Path) -> None:
    for path in directory.rglob("*"):
        path.chmod(0o500 if path.is_dir() else 0o400)
    directory.chmod(0o500)


def _fingerprints(directory: Path) -> dict[str, str]:
    return {str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in directory.rglob("*") if path.is_file()}


def prepare_evals(
    output_dir: Path, *, source_root: Path = ROOT, bundle_executable: Path | None = None,
    synthetic_bundle: bool = False,
) -> dict[str, str | int]:
    output = _safe_output(output_dir)
    source_root = source_root.resolve()
    if (bundle_executable is None) == (not synthetic_bundle):
        raise ValueError("supply a real bundled executable or explicitly choose a synthetic bundle fixture")
    if bundle_executable is not None:
        bundle_executable = bundle_executable.absolute()
        if not bundle_executable.is_file() or not os.access(bundle_executable, os.X_OK):
            raise ValueError("bundled executable is unavailable or not executable")
    definitions = json.loads((source_root / "tests" / "skill_evals.json").read_text())
    if [case["id"] for case in definitions["evals"]] != list(range(1, 8)):
        raise ValueError("the seven expected evaluation cases are required")
    output.mkdir(parents=True, exist_ok=True)
    output.chmod(0o700)
    runtime = output / "runtime"
    _launcher(runtime / "orbit-os", "orbit_os.cli", source_root)
    _launcher(runtime / "orbitdiff", "orbitdiff.cli", source_root)
    if synthetic_bundle:
        bundle_executable = runtime / "Orbit OS.app" / "Contents" / "MacOS" / "orbit-os"
        _launcher(bundle_executable, "orbit_os.cli", source_root)
    assert bundle_executable is not None

    sys.path.insert(0, str(source_root / "src"))
    now = datetime.now(UTC).replace(microsecond=0)
    seed = output / "_seed"
    _export(seed / "personal-partial", ["nova_labs"], ["nova_labs", "pixel_forge"])
    _export(seed / "dated-baseline", ["nova_labs", "pixel_forge"], ["nova_labs", "pixel_forge"])
    _export(seed / "dated-current", ["nova_labs", "ember_lab"], ["nova_labs", "pixel_forge"])
    _export(seed / "dated-older", ["nova_labs"], ["nova_labs", "pixel_forge"])
    _public_workspace(seed / "public-pending-failed", failed=True, now=now)
    _public_workspace(seed / "public-existing", failed=False, now=now)
    fixtures_by_case = {
        1: [], 2: ["personal-partial"], 3: ["public-pending-failed"], 4: [],
        5: ["dated-baseline", "dated-current", "dated-older"], 6: ["public-existing"], 7: [],
    }
    runs: list[dict[str, Any]] = []
    source_fingerprints = {}
    for case in definitions["evals"]:
        for variant in ("with_skill", "old_skill"):
            run = output / f"eval-{case['id']}-{case['name']}" / variant
            fixtures = run / "fixtures"
            fixtures.mkdir(parents=True)
            for name in fixtures_by_case[case["id"]]:
                shutil.copytree(seed / name, fixtures / name)
            _readonly(fixtures)
            source_workspace = None
            if case["id"] in (3, 6):
                source_workspace = str(fixtures / fixtures_by_case[case["id"]][0])
            executable = bundle_executable if case["id"] == 7 else runtime / "orbit-os"
            runtime_kind = "source-checkout launcher"
            if case["id"] == 7:
                runtime_kind = "synthetic app-path launcher; not native-package validation" if synthetic_bundle else "provided native app executable"
            context = {
                "case_id": case["id"], "variant": variant,
                "source_checkout": str(source_root), "orbit_os_executable": str(executable),
                "orbitdiff_executable": None if case["id"] == 7 else str(runtime / "orbitdiff"),
                "runtime_kind": runtime_kind, "write_workspace": str(run / "workspace"),
                "source_workspace": source_workspace, "output_directory": str(run / "outputs"),
                "fixtures": {name: str(fixtures / name) for name in fixtures_by_case[case["id"]]},
                "fixture_created_at": now.isoformat(),
            }
            (run / "outputs").mkdir()
            _json(run / "context.json", context)
            prompt = (
                f"Read the supplied context file: {run / 'context.json'}\n\n"
                f"Task:\n{case['prompt']}\n\n"
                "Use the exact runtime and input paths in context. Write only in the assigned output_directory "
                "and write_workspace. Source fixtures are read-only. Do not inspect another evaluation run or "
                "assessment metadata. Do not make network requests. Save a concise result with commands and "
                "observed outputs as outputs/result.md.\n"
            )
            _write(run / "prompt.txt", prompt)
            source_fingerprints[str(run)] = _fingerprints(fixtures)
            runs.append({
                "id": case["id"], "name": case["name"], "variant": variant,
                "prompt_file": str(run / "prompt.txt"), "context_file": str(run / "context.json"),
                "files": [str(run / name) for name in case["files"]],
                "outputs": str(run / "outputs"),
            })
    _readonly(seed)
    manifest = output / "cases.json"
    _json(manifest, {"skill_name": "orbitdiff", "cases": runs})
    _json(output / "assessment.json", {"definitions": definitions, "source_fingerprints": source_fingerprints})
    return {"manifest": str(manifest), "assessment": str(output / "assessment.json"), "runs": len(runs)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, default=ROOT)
    bundle = parser.add_mutually_exclusive_group(required=True)
    bundle.add_argument("--bundle-executable", type=Path)
    bundle.add_argument("--synthetic-bundle", action="store_true", help="Test command resolution, not native packaging")
    args = parser.parse_args(argv)
    try:
        receipt = prepare_evals(args.output_dir, source_root=args.source_root,
                                bundle_executable=args.bundle_executable, synthetic_bundle=args.synthetic_bundle)
    except (OSError, ValueError, KeyError, sqlite3.Error) as error:
        print(f"Skill evaluation preparation failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(receipt, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
