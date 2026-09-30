"""Verify supplied OrbitDiff artifacts in a clean installation outside the checkout."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from build_skill import SKILL_FILES, _check_path
from package_audit import scan_archive
from prepare_skill_evals import _RUNTIME_PROBE, _digest, _fingerprints, _metadata, _wheel_contract

ROOT = Path(__file__).resolve().parents[1]


def _zip_files(path: Path, *, limit: int) -> dict[str, bytes]:
    _check_path(path)
    if not path.is_file() or path.stat().st_size > limit:
        raise ValueError("artifact is missing or oversized")
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        names = [item.filename for item in members]
        if (len(names) > 10000 or len(names) != len(set(names))
                or sum(item.file_size for item in members) > limit):
            raise ValueError("archive contains duplicate members or exceeds its size limit")
        findings = scan_archive(path, [])
        if findings:
            raise ValueError("artifact audit rejected archive: " + "; ".join(findings[:5]))
        return {item.filename: archive.read(item) for item in members if not item.is_dir()}


def _linked_file(origin: str, reference: str, files: dict[str, bytes]) -> str | None:
    link = urlsplit(reference.strip("<>"))
    if link.scheme in {"https", "http"}:
        return None
    if link.scheme or link.netloc or "\\" in reference:
        raise ValueError("skill reference has an unsupported location")
    if not link.path:
        return None
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(origin), unquote(link.path)))
    if not resolved.startswith("orbitdiff/") or resolved not in files:
        raise ValueError("skill reference is missing or escapes its installation: " + reference)
    return resolved


def _metadata_string(raw: str, *, quoted: bool) -> str:
    if raw.startswith('"'):
        value = json.loads(raw)
    elif (quoted or not raw or raw[0] in "-?:,[]{}#&*!|>'%@`"
          or ": " in raw or " #" in raw or raw.strip() != raw
          or raw.casefold() in {"true", "false", "null", "yes", "no", "on", "off", "~"}
          or re.fullmatch(r"[\d.+-]+", raw)):
        raise ValueError("skill metadata requires an unambiguous string value")
    else:
        value = raw
    if not isinstance(value, str) or not value or any(ord(character) < 32 for character in value):
        raise ValueError("skill metadata requires a nonempty single-line string")
    return value


def _metadata_map(text: str, *, top_keys: set[str], map_key: str,
                  child_keys: set[str] | None = None) -> tuple[dict[str, str], dict[str, str]]:
    """Accept the packaged flat YAML string maps, never silently skip a line."""
    lines = text.splitlines()
    if len(text) > 16 * 1024 or len(lines) > 128 or "\t" in text:
        raise ValueError("skill metadata document is oversized or malformed")
    top: dict[str, str] = {}
    children: dict[str, str] = {}
    in_map = False
    for line in lines:
        if not line.strip():
            continue
        if line.startswith(" "):
            match = re.fullmatch(r"  ([a-z][a-z0-9_-]*): (.+)", line)
            if (not in_map or match is None or match.group(1) in children
                    or (child_keys is not None and match.group(1) not in child_keys)):
                raise ValueError("skill metadata has a duplicate, unknown, or malformed nested key")
            children[match.group(1)] = _metadata_string(match.group(2), quoted=True)
            continue
        match = re.fullmatch(r"([a-z][a-z0-9_-]*):(?: (.+))?", line)
        if match is None or match.group(1) in top or match.group(1) not in top_keys | {map_key}:
            raise ValueError("skill frontmatter or interface has a duplicate, unknown, or malformed key")
        key, value = match.group(1), match.group(2)
        in_map = key == map_key
        if in_map:
            if value is not None:
                raise ValueError("skill metadata mapping requires an indented string map")
            top[key] = ""
        else:
            top[key] = _metadata_string(value or "", quoted=False)
    if set(top) != top_keys | {map_key} or not children or (child_keys is not None and set(children) != child_keys):
        raise ValueError("skill metadata document is missing required fields")
    return top, children


def validate_skill_archive(archive: Path, destination: Path, version: str) -> dict[str, Any]:
    """Validate the complete archive before creating its isolated installation."""
    files = _zip_files(archive, limit=8 * 1024 * 1024)
    expected = {"orbitdiff/" + name for name in (*SKILL_FILES, "LICENSE")}
    if set(files) != expected:
        raise ValueError("skill archive has missing or unexpected packaged files")
    text = files["orbitdiff/SKILL.md"].decode("utf-8")
    lines = text.splitlines()
    if not lines or lines[0] != "---" or "---" not in lines[1:129]:
        raise ValueError("skill frontmatter is missing")
    frontmatter, metadata = _metadata_map("\n".join(lines[1:lines.index("---", 1)]),
        top_keys={"name", "description", "license", "compatibility"}, map_key="metadata")
    if frontmatter["name"] != "orbitdiff":
        raise ValueError("skill name is invalid")
    if not 1 <= len(frontmatter["description"]) <= 1024:
        raise ValueError("skill description is invalid")
    if metadata.get("version") != version:
        raise ValueError("skill and requested runtime version mismatch")
    declaration = frontmatter["compatibility"]
    minor = re.search(r"\b(\d+\.\d+)\.x\b", declaration)
    minimum = re.search(r"\bminimum (\d+\.\d+\.\d+)\b", declaration)
    if (not re.fullmatch(r"\d+\.\d+\.\d+", version) or minor is None or minimum is None
            or version.rsplit(".", 1)[0] != minor.group(1)
            or tuple(map(int, version.split("."))) < tuple(map(int, minimum.group(1).split(".")))
            or "local command execution" not in declaration or "stable" not in declaration):
        raise ValueError("skill runtime compatibility instructions do not cover the artifact")
    links = []
    for name, content in files.items():
        if name.endswith(".md"):
            for reference in re.findall(r"\]\(([^)]+)\)", content.decode("utf-8")):
                linked = _linked_file(name, reference, files)
                if linked:
                    links.append(linked)
    host = files["orbitdiff/agents/openai.yaml"].decode("utf-8")
    _, fields = _metadata_map(host, top_keys=set(), map_key="interface",
        child_keys={"display_name", "short_description", "icon_small", "icon_large", "default_prompt"})
    if "$orbitdiff" not in fields["default_prompt"]:
        raise ValueError("skill host metadata is invalid")
    for key in ("icon_small", "icon_large"):
        target = _linked_file("orbitdiff/SKILL.md", fields.get(key, "missing"), files)
        if target is None or ET.fromstring(files[target]).tag not in {"svg", "{http://www.w3.org/2000/svg}svg"}:
            raise ValueError("skill asset is not a valid local SVG")
    _check_path(destination)
    if destination.exists():
        raise ValueError("skill installation destination must be fresh")
    destination.mkdir(parents=True, mode=0o700)
    for name, content in files.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        target.chmod(0o600)
    return {"version": version, "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()},
            "references_verified": sorted(set(links)), "metadata_verified": True,
            "compatibility_verified": True, "installation_route": "complete audited archive extraction",
            "host_discovery": "unproven", "consuming_agent_workflow": "unproven"}


def _environment(root: Path) -> dict[str, str]:
    directories = {name: root / name for name in ("home", "data", "config", "cache", "tmp", "bytecode")}
    for path in directories.values():
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    env = {key: os.environ[key] for key in ("SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT") if key in os.environ}
    env.update({
        "HOME": str(directories["home"]), "USERPROFILE": str(directories["home"]),
        "XDG_DATA_HOME": str(directories["data"]), "XDG_CONFIG_HOME": str(directories["config"]),
        "XDG_CACHE_HOME": str(directories["cache"]), "APPDATA": str(directories["data"]),
        "LOCALAPPDATA": str(directories["data"]), "TMPDIR": str(directories["tmp"]),
        "TEMP": str(directories["tmp"]), "TMP": str(directories["tmp"]),
        "PYTHONNOUSERSITE": "1", "PYTHONSAFEPATH": "1", "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONPYCACHEPREFIX": str(directories["bytecode"]),
        "PIP_CONFIG_FILE": os.devnull, "PIP_DISABLE_PIP_VERSION_CHECK": "1",
        "PIP_NO_INPUT": "1", "PIP_NO_CACHE_DIR": "1", "LANG": "C.UTF-8",
    })
    return env


def _run(argv: list[str], cwd: Path, commands: list[dict[str, Any]], *,
         input_text: str | None = None, timeout: int = 30) -> str:
    entry: dict[str, Any] = {"argv": argv, "cwd": str(cwd)}
    try:
        completed = subprocess.run(argv, cwd=cwd, env=_environment(cwd), input=input_text,
                                   capture_output=True, text=True, check=False, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        entry.update({"returncode": None, "timeout_seconds": timeout,
                      "stdout": (error.stdout or b"").decode("utf-8", errors="replace"),
                      "stderr": (error.stderr or b"").decode("utf-8", errors="replace")})
        commands.append(entry)
        raise ValueError("installation verification command timed out") from error
    except OSError as error:
        entry.update({"returncode": None, "stdout": "", "stderr": str(error)})
        commands.append(entry)
        raise ValueError("installation verification command could not start") from error
    entry.update({"returncode": completed.returncode, "stdout": completed.stdout, "stderr": completed.stderr})
    commands.append(entry)
    if completed.returncode:
        raise ValueError("installation verification command failed: " + completed.stderr.strip()[-2000:])
    if len(completed.stdout) + len(completed.stderr) > 4 * 1024 * 1024:
        raise ValueError("installation verification command output exceeded its limit")
    return completed.stdout


def verify_runtime(python: Path, wheel: Path, workdir: Path,
                   commands: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    contract = _wheel_contract(wheel)
    result = _run([str(python), "-I", "-B", "-c", _RUNTIME_PROBE], workdir,
                  commands if commands is not None else [],
                  input_text=json.dumps(dict(contract, cache_parent=str(workdir))))
    identity: dict[str, Any] = json.loads(result)
    if identity["python"] != str(python):
        raise ValueError("the imported runtime uses a different Python executable")
    return identity


def _sanitize(value: Any, locations: dict[str, str]) -> Any:
    if isinstance(value, dict):
        return {_sanitize(key, locations): _sanitize(item, locations) for key, item in value.items()}
    if isinstance(value, list):
        return [_sanitize(item, locations) for item in value]
    if isinstance(value, str):
        for path, label in sorted(locations.items(), key=lambda item: len(item[0]), reverse=True):
            value = value.replace(path, label)
        return re.sub(r"/(?:Users|home|private|tmp|var|opt|usr|Library|Applications|Volumes)/[^\s\"'<>]+",
                      "<LOCAL_PATH>", value)
    return value


def _partial(personal: dict[str, Any]) -> None:
    accounts = {account["username"]: account for account in personal["accounts"]}
    if (personal["username"] != "atlas_studio" or personal["last_success_at"] is not None
            or personal["metrics"]["not_following_back"] is not None
            or accounts["nova_labs"]["relationship"] != "mutual"
            or accounts["pixel_forge"]["followed_by"] is not None
            or accounts["pixel_forge"]["relationship"] != "unknown"
            or any(direction["complete"] for direction in personal["coverage_details"].values())):
        raise ValueError("partial owner export did not preserve unknown evidence")


def check_install(wheel: Path, skill_archive: Path, source_commit: str, *, output_dir: Path | None = None,
                  expected_version: str | None = None, provenance: str = "candidate",
                  wheelhouse: Path | None = None) -> dict[str, Any]:
    receipt: dict[str, Any] = {"schema_version": 1, "outcome": "error", "phase": "output",
                               "provenance": provenance, "source_commit": source_commit,
                               "commands": [], "checks": {}, "receipt_path": None,
                               "live_collection": "not performed"}
    output = None
    locations = {str(ROOT): "<CHECKOUT>", str(Path.home()): "<HOME>",
                 str(Path(sys.base_prefix)): "<PYTHON_BASE>", str(Path(sys.executable)): "<CHECK_PYTHON>"}
    try:
        if output_dir is None:
            output = Path(tempfile.mkdtemp(prefix="orbit-skill-install-", dir=Path(tempfile.gettempdir()).resolve()))
        else:
            requested = output_dir.absolute()
            _check_path(requested)
            if requested.resolve().is_relative_to(ROOT) or requested.exists():
                raise ValueError("choose a fresh installation output directory outside the checkout")
            requested.mkdir(parents=True, mode=0o700)
            output = requested
        locations[str(output)] = "<CHECK_ROOT>"
        receipt["receipt_path"] = "install-receipt.json"
        receipt["phase"] = "artifacts"
        if provenance not in {"candidate", "published"} or not re.fullmatch(r"[0-9a-fA-F]{40}", source_commit):
            raise ValueError("provenance and a full source commit are required")
        wheel, skill_archive = wheel.absolute(), skill_archive.absolute()
        _check_path(skill_archive)
        locations[str(wheel)] = "<WHEEL>"
        locations[str(skill_archive)] = "<SKILL_ARCHIVE>"
        files = _zip_files(wheel, limit=128 * 1024 * 1024)
        contract = _wheel_contract(wheel)
        version = contract["version"]
        distribution = contract["metadata_name"].split("/", 1)[0] + "/"
        if any(not name.startswith(("orbit_os/", "orbitdiff/", distribution)) for name in files):
            raise ValueError("wheel contains unexpected top-level installation content")
        if expected_version is not None and version != expected_version:
            raise ValueError("candidate wheel version does not match the expected version")
        receipt["version"] = version
        receipt["artifacts"] = {"wheel": {"name": wheel.name, "sha256": _digest(wheel)},
                                 "skill_archive": {"name": skill_archive.name, "sha256": _digest(skill_archive)}}
        receipt["skill"] = validate_skill_archive(skill_archive, output / "skill", version)
        receipt["phase"] = "installation"
        commands = receipt["commands"]
        _run([sys.executable, "-I", "-B", "-m", "venv", str(output / "venv")], output, commands, timeout=60)
        binary = output / "venv" / ("Scripts" if os.name == "nt" else "bin")
        python = binary / ("python.exe" if os.name == "nt" else "python")
        install = [str(python), "-I", "-m", "pip", "install", "--only-binary=:all:", "--timeout", "20", "--retries", "1"]
        if wheelhouse is not None:
            _check_path(wheelhouse)
            locations[str(wheelhouse.absolute())] = "<WHEELHOUSE>"
            install.extend(["--no-index", "--find-links", str(wheelhouse.absolute())])
        _run([*install, str(wheel)], output, commands, timeout=120)
        _run([str(python), "-I", "-m", "pip", "check"], output, commands)
        identity = verify_runtime(python, wheel, output, commands)
        receipt["runtime"] = identity
        receipt["phase"] = "offline_workflows"
        orbit = binary / ("orbit-os.exe" if os.name == "nt" else "orbit-os")
        legacy = binary / ("orbitdiff.exe" if os.name == "nt" else "orbitdiff")
        for executable, label in ((orbit, "Orbit OS"), (legacy, "OrbitDiff")):
            if _run([str(executable), "--version"], output, commands).strip() != f"{label} {version}":
                raise ValueError("retained installed executable version mismatch")
            help_text = _run([str(executable), "--help"], output, commands)
            if not all(command in help_text for command in ("demo", "status", "report")):
                raise ValueError("installed executable is missing required offline commands")
        defaults = json.loads(_run([str(python), "-I", "-B", "-c",
            "import json; from orbit_os.workspace import default_workspace; from orbitdiff.paths import default_data_dir; "
            "print(json.dumps([str(default_workspace()), str(default_data_dir())]))"], output, commands))
        if any(not Path(path).is_relative_to(output) or Path(path).exists() for path in defaults):
            raise ValueError("default storage was not isolated and absent")
        workspace = output / "selected-workspace"
        missing = json.loads(_run([str(orbit), "status", "--workspace", str(workspace), "--json"], output, commands))
        if workspace.exists() or missing["personal"]["status"] != "missing" or missing["watchlist"]:
            raise ValueError("stored inspection initialized the selected missing workspace")
        demo = json.loads(_run([str(orbit), "demo"], output, commands))
        if (not demo["workspace"]["demo"] or not demo["personal"]["accounts"] or not demo["personal"]["events"]
                or not demo["watchlist"] or not demo["watchlist"][0]["events"]):
            raise ValueError("offline demo did not exercise both evidence lanes")
        legacy_demo = _run([str(legacy), "demo"], output, commands)
        if not all(marker in legacy_demo for marker in ("baseline stored", "pending changes observed", "following_started", "following_stopped")):
            raise ValueError("legacy public demo did not exercise confirmed changes")
        source = output / "owner-export"
        source.mkdir(mode=0o700)
        def row(name: str) -> dict[str, Any]:
            return {"string_list_data": [{"value": name, "timestamp": 1}]}
        (source / "followers_1.json").write_text(json.dumps([row("nova_labs")]))
        (source / "following.json").write_text(json.dumps({"relationships_following": [row("nova_labs"), row("pixel_forge")]}))
        before = (_fingerprints(source), _metadata(source))
        imported = json.loads(_run([str(orbit), "import", str(source), "--account", "atlas_studio",
                                   "--workspace", str(workspace)], output, commands))
        _partial(imported)
        stored = json.loads(_run([str(orbit), "relationships", "--workspace", str(workspace), "--json"], output, commands))
        _partial(stored)
        state = json.loads(_run([str(orbit), "status", "--workspace", str(workspace), "--json"], output, commands))
        _partial(state["personal"])
        if state["watchlist"] or not (workspace / "personal" / "snapshots.json").is_file():
            raise ValueError("owner import was not persisted separately from public tracking")
        if before != (_fingerprints(source), _metadata(source)):
            raise ValueError("owner export content or metadata changed")
        if any(Path(path).exists() for path in defaults):
            raise ValueError("a workflow wrote to default storage")
        receipt["phase"] = "preservation"
        if identity != verify_runtime(python, wheel, output, commands):
            raise ValueError("installed runtime changed during verification")
        if (receipt["artifacts"]["wheel"]["sha256"] != _digest(wheel)
                or receipt["artifacts"]["skill_archive"]["sha256"] != _digest(skill_archive)):
            raise ValueError("input artifacts changed during verification")
        receipt["checks"] = dict.fromkeys(("installed_files_match_wheel", "installed_module_origins", "retained_executables",
            "both_demo_lanes", "partial_owner_import", "persisted_owner_reads", "source_inputs_preserved",
            "selected_workspace", "default_storage_unchanged", "skill_archive_installation"), True)
        receipt["outcome"], receipt["phase"] = "success", "complete"
    except (OSError, ValueError, KeyError, TypeError, IndexError, zipfile.BadZipFile, ET.ParseError) as error:
        receipt["error"] = str(error)
    sanitized: dict[str, Any] = _sanitize(receipt, locations)
    if output is not None:
        path = output / "install-receipt.json"
        path.write_text(json.dumps(sanitized, indent=2, sort_keys=True) + "\n")
        path.chmod(0o600)
    return sanitized


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheel", type=Path, required=True)
    parser.add_argument("--skill-archive", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--expected-version")
    parser.add_argument("--provenance", choices=("candidate", "published"), default="candidate")
    parser.add_argument("--wheelhouse", type=Path, help="Optional offline dependency wheels; disables package-index access")
    args = parser.parse_args(argv)
    result = check_install(args.wheel, args.skill_archive, args.source_commit, output_dir=args.output_dir,
                           expected_version=args.expected_version, provenance=args.provenance, wheelhouse=args.wheelhouse)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["outcome"] == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
