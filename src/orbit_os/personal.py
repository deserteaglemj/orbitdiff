"""Bounded Instagram relationship exports in a private, owner-bound workspace.

Only recognized follower and following JSON is ingested. Capture dates and
completeness are user declarations, never inferred from relationship timestamps.
"""

from __future__ import annotations

import hashlib
import importlib
import io
import json
import os
import re
import stat
import struct
import uuid
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlsplit

MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_INPUT_BYTES = 32 * 1024 * 1024
MAX_STATE_BYTES = 32 * 1024 * 1024
MAX_FILES = 1024
MAX_ACCOUNTS = 100_000
MAX_SNAPSHOTS = 100
MAX_EVENTS = 10_000
_HANDLE = re.compile(r"(?!\.+$)[A-Za-z0-9._]{1,30}")
_MEMBER = re.compile(r"(followers|following)(?:_([1-9][0-9]{0,3}))?\.json")
_DIGEST = re.compile(r"[a-f0-9]{64}")
_DIRECTIONS = ("followers", "following")


def _handle(value: Any) -> str:
    if not isinstance(value, str) or not _HANDLE.fullmatch(value):
        raise ValueError("A valid Instagram account handle is required.")
    return value.lower()


def _capture(value: str | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError("The capture time must be an ISO timestamp with a timezone.")
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            raise ValueError("missing timezone")
        parsed = parsed.astimezone(UTC)
        if parsed > datetime.now(UTC) + timedelta(minutes=5):
            raise ValueError("future timestamp")
        return parsed.isoformat(timespec="seconds")
    except (ValueError, OverflowError) as error:
        raise ValueError("The capture time must be a valid, non-future timestamp with a timezone.") from error


def _protected(parts: tuple[str, ...]) -> bool:
    return any(
        part.lower() == ".ssh" or part.lower() == ".env" or part.lower().startswith(".env.")
        for part in parts
    )


def _local_path(path: Path) -> Path:
    if _protected(path.parts):
        raise ValueError("A protected path cannot be used for relationship imports.")
    if ".." in path.parts:
        raise ValueError("Parent traversal is not permitted in an import path.")
    path = path.absolute()
    if _protected(path.parts):
        raise ValueError("A protected path cannot be used for relationship imports.")
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        try:
            status = current.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(status.st_mode):
            raise ValueError("Symbolic links are not permitted in import or workspace paths.")
    return path


def _read_file(path: Path, limit: int) -> bytes:
    path = _local_path(path)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    with os.fdopen(os.open(path, flags), "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise ValueError("An import must be a regular file without links.")
        if before.st_size > limit:
            raise ValueError("The file exceeds the import size limit.")
        content = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
        if len(content) > limit:
            raise ValueError("The file exceeds the import size limit.")
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_size, after.st_mtime_ns, after.st_ctime_ns,
        ):
            raise ValueError("The import file changed while it was being read.")
        return content


def _member_path(name: str) -> PurePosixPath:
    if not isinstance(name, str) or not name or len(name) > 1024:
        raise ValueError("Invalid import member path.")
    raw_parts = name.rstrip("/").split("/")
    if (
        name.startswith("/") or "\\" in name or ":" in name
        or any(part in {"", ".", ".."} for part in raw_parts)
        or any(ord(char) < 32 or ord(char) == 127 for char in name)
        or len(raw_parts) > 16 or any(len(part) > 255 for part in raw_parts)
    ):
        raise ValueError("Unsafe import member path.")
    if _protected(tuple(raw_parts)):
        raise ValueError("A protected path is not accepted inside an export.")
    return PurePosixPath(*raw_parts)


def _recognized(path: PurePosixPath) -> tuple[str, int] | None:
    match = _MEMBER.fullmatch(path.name)
    if not match:
        return None
    if len(path.parts) > 1 and path.parent.name != "followers_and_following":
        return None
    return match[1], int(match[2]) if match[2] else 0


def _check_zip_directory(payload: bytes) -> None:
    """Bound the central directory before ZipFile allocates a member per entry."""
    end = payload.rfind(b"PK\x05\x06", max(0, len(payload) - 65557))
    if end < 0 or len(payload) - end < 22:
        raise ValueError("The export ZIP directory is invalid.")
    fields = struct.unpack_from("<4s4H2LH", payload, end)
    if fields[3] > MAX_FILES or fields[4] > MAX_FILES:
        raise ValueError("The archive contains too many files for the import limit.")
    if (
        fields[1] != 0 or fields[2] != 0 or fields[3] != fields[4]
        or end + 22 + fields[7] != len(payload) or fields[5] > end
        or fields[5] == 0xFFFFFFFF or fields[6] == 0xFFFFFFFF
    ):
        raise ValueError("Unsupported export ZIP directory structure.")
    position = end - fields[5]
    count = 0
    while position < end:
        if position + 46 > end or payload[position:position + 4] != b"PK\x01\x02":
            raise ValueError("The export ZIP directory is invalid.")
        lengths = struct.unpack_from("<3H", payload, position + 28)
        position += 46 + sum(lengths)
        count += 1
        if count > MAX_FILES:
            raise ValueError("The archive contains too many files for the import limit.")
        if lengths[0] > 1024 or position > end:
            raise ValueError("The export ZIP member path exceeds its size limit.")
    if count != fields[4]:
        raise ValueError("The export ZIP directory entry count is invalid.")


def _zip_files(payload: bytes) -> dict[str, bytes]:
    _check_zip_directory(payload)
    result: dict[str, bytes] = {}
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as bundle:
            members = bundle.infolist()
            if len(members) > MAX_FILES:
                raise ValueError("The archive contains too many files for the import limit.")
            total = 0
            seen: set[str] = set()
            for member in members:
                path = _member_path(member.filename)
                if member.filename in seen:
                    raise ValueError("Duplicate archive member paths are not accepted.")
                seen.add(member.filename)
                mode = member.external_attr >> 16
                kind = stat.S_IFMT(mode)
                if kind not in {0, stat.S_IFREG, stat.S_IFDIR}:
                    raise ValueError("Archive members must be regular files or directories without links.")
                if member.is_dir():
                    continue
                if not _recognized(path):
                    continue
                if member.flag_bits & 1 or member.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                    raise ValueError("Encrypted or unsupported archive compression is not accepted.")
                total += member.file_size
                if member.file_size > MAX_FILE_BYTES or total > MAX_INPUT_BYTES:
                    raise ValueError("The decompressed export exceeds the import size limit.")
                with bundle.open(member) as stream:
                    content = stream.read(MAX_FILE_BYTES + 1)
                if len(content) > MAX_FILE_BYTES or len(content) != member.file_size:
                    raise ValueError("The decompressed member exceeds its size limit.")
                result[str(path)] = content
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError, EOFError) as error:
        raise ValueError("The export ZIP could not be read safely.") from error
    return result


def _json(payload: bytes) -> Any:
    def unique_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON fields are not accepted.")
            result[key] = value
        return result

    try:
        return json.loads(payload, object_pairs_hook=unique_keys)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise ValueError("A relationship JSON document is malformed.") from error


def _rows(payload: bytes, direction: str, account: str) -> list[str]:
    decoded = _json(payload)
    if isinstance(decoded, dict):
        for field in ("account", "username", "owner"):
            if field in decoded:
                owner = decoded[field]
                if isinstance(owner, dict):
                    owner = owner.get("username")
                if _handle(owner) != account:
                    raise ValueError("The export account does not match the selected account.")
        decoded = decoded.get(f"relationships_{direction}")
    if not isinstance(decoded, list) or len(decoded) > MAX_ACCOUNTS:
        raise ValueError("The export must contain a bounded relationship list.")
    result: set[str] = set()
    for row in decoded:
        if not isinstance(row, dict):
            raise ValueError("A relationship entry is malformed.")
        values = row.get("string_list_data")
        if not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], dict):
            raise ValueError("A relationship entry needs one handle record.")
        record = values[0]
        handle = _handle(record.get("value") or row.get("title"))
        if row.get("title") and _handle(row["title"]) != handle:
            raise ValueError("A relationship entry contains conflicting handle fields.")
        href = record.get("href")
        if href is not None:
            if not isinstance(href, str) or len(href) > 200:
                raise ValueError("A relationship handle URL is malformed.")
            url = urlsplit(href)
            url_handle = url.path.rstrip("/").removeprefix("/_u/").lstrip("/")
            if (
                url.scheme not in {"http", "https"} or url.netloc.lower() not in {"instagram.com", "www.instagram.com"}
                or url.query or url.fragment or _handle(url_handle) != handle
            ):
                raise ValueError("A relationship entry contains conflicting handle fields.")
        result.add(handle)
    return sorted(result)


def _parse_files(files: dict[str, bytes], account: str) -> tuple[dict[str, list[str] | None], dict[str, list[int]]]:
    if not isinstance(files, dict) or not files or len(files) > MAX_FILES:
        raise ValueError("Supply a bounded export ZIP or relationship JSON files.")
    total = 0
    for name, payload in files.items():
        _member_path(name)
        if not isinstance(payload, bytes):
            raise ValueError("Imported file content must be bytes.")
        total += len(payload)
    if total > MAX_INPUT_BYTES:
        raise ValueError("The upload exceeds the import size limit.")
    archives = [name for name in files if name.lower().endswith(".zip")]
    if archives:
        if len(files) != 1:
            raise ValueError("Supply one ZIP, or named relationship JSON files, not both.")
        files = _zip_files(files[archives[0]])
    parents: set[str] = set()
    values: dict[str, set[str]] = {}
    shards: dict[str, list[int]] = {direction: [] for direction in _DIRECTIONS}
    for name, payload in files.items():
        path = _member_path(name)
        recognized = _recognized(path)
        if recognized is None:
            continue
        if len(payload) > MAX_FILE_BYTES:
            raise ValueError("The relationship file exceeds the import size limit.")
        direction, shard = recognized
        parents.add(str(path.parent))
        if len(parents) > 1:
            raise ValueError("Multiple export roots are ambiguous; import one account scope at a time.")
        if shard in shards[direction] or (shards[direction] and (shard == 0 or 0 in shards[direction])):
            raise ValueError("Overlapping relationship shards are ambiguous.")
        shards[direction].append(shard)
        values.setdefault(direction, set()).update(_rows(payload, direction, account))
        if sum(len(handles) for handles in values.values()) > MAX_ACCOUNTS:
            raise ValueError("The relationship account count exceeds the import limit.")
    if not values:
        raise ValueError("No recognized followers or following JSON files were found.")
    return (
        {direction: sorted(values[direction]) if direction in values else None for direction in _DIRECTIONS},
        {direction: sorted(parts) for direction, parts in shards.items()},
    )


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def _digest(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _coverage(snapshot: dict[str, Any], direction: str) -> dict[str, Any]:
    shards = snapshot["shards"][direction]
    present = snapshot[direction] is not None
    contiguous = bool(shards) and (shards == [0] or shards == list(range(1, max(shards) + 1)))
    complete = present and contiguous and snapshot["captured_at"] is not None and snapshot["declarations"][direction]
    return {
        "present": present, "complete": complete,
        "declared_complete": snapshot["declarations"][direction],
        "basis": "user_declared" if complete else "unknown",
        "independently_verified": False, "shards": shards,
        "shards_contiguous": contiguous, "captured_at_known": snapshot["captured_at"] is not None,
    }


def _state(workspace: Path) -> dict[str, Any] | None:
    path = _local_path(workspace / "personal" / "snapshots.json")
    if not path.exists():
        return None
    raw = _json(_read_file(path, MAX_STATE_BYTES))
    if not isinstance(raw, dict) or type(raw.get("schema_version")) is not int or raw["schema_version"] != 1:
        raise ValueError("Unsupported personal snapshot schema.")
    account = _handle(raw.get("account"))
    snapshots = raw.get("snapshots")
    if not isinstance(snapshots, list) or not snapshots or len(snapshots) > MAX_SNAPSHOTS:
        raise ValueError("Invalid personal snapshot history.")
    clean: list[dict[str, Any]] = []
    seen: set[str] = set()
    captures: set[str] = set()
    for item in snapshots:
        if not isinstance(item, dict):
            raise ValueError("Invalid personal snapshot.")
        snapshot: dict[str, Any] = {
            "captured_at": _capture(item.get("captured_at")),
            "imported_at": _capture(item.get("imported_at")),
            "shards": {}, "declarations": {},
        }
        if snapshot["imported_at"] is None:
            raise ValueError("Invalid snapshot import timestamp.")
        if not isinstance(item.get("shards"), dict) or not isinstance(item.get("declarations"), dict):
            raise ValueError("Invalid stored coverage.")
        for direction in _DIRECTIONS:
            values = item.get(direction)
            if values is not None:
                if not isinstance(values, list) or len(values) > MAX_ACCOUNTS:
                    raise ValueError("Invalid stored relationship list.")
                values = sorted({_handle(value) for value in values})
            parts = item.get("shards", {}).get(direction)
            declared = item.get("declarations", {}).get(direction)
            if (
                not isinstance(parts, list) or len(parts) > MAX_FILES
                or any(type(part) is not int or not 0 <= part <= 9999 for part in parts)
                or parts != sorted(set(parts)) or (0 in parts and len(parts) > 1)
                or not isinstance(declared, bool) or bool(parts) != (values is not None)
            ):
                raise ValueError("Invalid stored coverage.")
            snapshot[direction] = values
            snapshot["shards"][direction] = parts
            snapshot["declarations"][direction] = declared
        if all(snapshot[direction] is None for direction in _DIRECTIONS):
            raise ValueError("A stored snapshot needs at least one direction.")
        if sum(len(snapshot[direction] or []) for direction in _DIRECTIONS) > MAX_ACCOUNTS:
            raise ValueError("The stored relationship account count exceeds the import limit.")
        snapshot["content_id"] = _content_id(snapshot, account)
        snapshot["id"] = _digest([snapshot["content_id"], snapshot["captured_at"]])
        if item.get("id") != snapshot["id"] or item.get("content_id") != snapshot["content_id"] or snapshot["id"] in seen:
            raise ValueError("Invalid snapshot identity.")
        if snapshot["captured_at"] in captures:
            raise ValueError("Stored snapshots conflict at the same capture time.")
        if snapshot["captured_at"]:
            captures.add(snapshot["captured_at"])
        seen.add(snapshot["id"])
        clean.append(snapshot)
    current = raw.get("current")
    if not isinstance(current, str) or not _DIGEST.fullmatch(current) or current not in seen:
        raise ValueError("Invalid current snapshot reference.")
    current_row = next(item for item in clean if item["id"] == current)
    newest = max((item["captured_at"] for item in clean if item["captured_at"]), default=None)
    if newest and current_row["captured_at"] != newest:
        raise ValueError("The current snapshot is not the latest dated observation.")
    return {"schema_version": 1, "account": account, "current": current, "snapshots": clean}


def _content_id(snapshot: dict[str, Any], account: str) -> str:
    return _digest([account, snapshot["followers"], snapshot["following"], snapshot["shards"]])


def _private_directory(path: Path) -> None:
    path = _local_path(path)
    missing: list[Path] = []
    current = path
    while not current.exists():
        missing.append(current)
        current = current.parent
    for directory in reversed(missing):
        try:
            directory.mkdir(mode=0o700)
        except FileExistsError:
            _local_path(directory)
    if not path.is_dir():
        raise ValueError("The personal workspace must be a directory.")
    path.chmod(0o700)


def _write_state(path: Path, payload: bytes) -> None:
    _local_path(path)
    temporary = path.with_name(f".snapshot-{uuid.uuid4().hex}.tmp")
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _acquire_import_lock(directory: Path) -> int:
    """Use an OS lock that releases on exit, including a process crash."""
    path = _local_path(directory / ".import.lock")
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("The import lock must be a regular private file.")
        if os.name == "nt":
            if info.st_size == 0:
                os.write(descriptor, b"\0")
            os.lseek(descriptor, 0, os.SEEK_SET)
            windows_lock = importlib.import_module("msvcrt")
            windows_lock.locking(descriptor, windows_lock.LK_NBLCK, 1)
        else:
            import fcntl
            os.fchmod(descriptor, 0o600)
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as error:
        os.close(descriptor)
        raise ValueError("Another personal import is active; retry after it finishes.") from error
    except BaseException:
        os.close(descriptor)
        raise
    return descriptor


def _store(
    workspace: Path, account: str, values: dict[str, list[str] | None],
    shards: dict[str, list[int]], captured_at: str | None,
    complete_followers: bool, complete_following: bool,
) -> tuple[dict[str, Any], dict[str, Any]]:
    directory = _local_path(workspace / "personal")
    _private_directory(directory)
    descriptor = _acquire_import_lock(directory)
    try:
        state = _state(workspace)
        if state is not None and state["account"] != account:
            raise ValueError("This workspace belongs to a different personal account.")
        now = datetime.now(UTC).isoformat(timespec="seconds")
        snapshot: dict[str, Any] = {
            **values, "captured_at": captured_at, "imported_at": now, "shards": shards,
            "declarations": {"followers": complete_followers, "following": complete_following},
        }
        snapshot["content_id"] = _content_id(snapshot, account)
        snapshot["id"] = _digest([snapshot["content_id"], captured_at])
        if state is None:
            state = {"schema_version": 1, "account": account, "current": snapshot["id"], "snapshots": []}
        snapshots: list[dict[str, Any]] = state["snapshots"]
        current = next((item for item in snapshots if item["id"] == state["current"]), None)
        duplicate = next((item for item in snapshots if item["id"] == snapshot["id"]), None)
        enriched = next((item for item in snapshots if item["content_id"] == snapshot["content_id"] and item["captured_at"] is None), None) if captured_at else None
        if captured_at and any(item["captured_at"] == captured_at and item["content_id"] != snapshot["content_id"] for item in snapshots):
            raise ValueError("Different rosters conflict at the same capture time.")
        if duplicate is not None:
            snapshot = duplicate
            snapshot["declarations"]["followers"] |= complete_followers
            snapshot["declarations"]["following"] |= complete_following
        elif enriched is not None:
            snapshots[snapshots.index(enriched)] = snapshot
        else:
            if len(snapshots) >= MAX_SNAPSHOTS:
                raise ValueError("The personal history limit is reached; preserve this workspace and start a new one.")
            snapshots.append(snapshot)
        if (
            current is None
            or (captured_at is not None and (current["captured_at"] is None or captured_at > current["captured_at"]))
        ):
            state["current"] = snapshot["id"]
        payload = _canonical(state)
        if len(payload) > MAX_STATE_BYTES:
            raise ValueError("The stored personal history exceeds its size limit.")
        _write_state(directory / "snapshots.json", payload)
        receipt = {
            "snapshot_id": snapshot["id"], "duplicate": duplicate is not None,
            "provenance_enriched": enriched is not None and duplicate is None,
            "current": state["current"] == snapshot["id"],
            "captured_at": snapshot["captured_at"], "imported_at": snapshot["imported_at"],
        }
        return state, receipt
    finally:
        os.close(descriptor)


def _empty() -> dict[str, Any]:
    return {
        "username": None, "status": "missing", "stale": True,
        "last_success_at": None, "last_attempt_at": None, "last_import_at": None,
        "metrics": dict.fromkeys((
            "followers", "following", "mutuals", "not_following_back", "followers_observed",
            "following_observed", "reciprocal_unknown", "unattributed_balance",
        )),
        "accounts": [], "events": [], "runs": [], "coverage": None,
        "coverage_details": {}, "snapshot_id": None, "source": "instagram_export",
        "provenance": {
            "source": "instagram_export", "owner_basis": "user_declared",
            "capture_time_basis": "unknown", "identity_basis": "username", "automatic_refresh": False,
        },
        "issues": [],
    }


def _relationship(following: bool | None, followed_by: bool | None) -> str:
    if following is True and followed_by is True:
        return "mutual"
    if following is True and followed_by is False:
        return "not_following_back"
    if following is False and followed_by is True:
        return "follows_you"
    return "unknown"


def _events(snapshots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    known = sorted((item for item in snapshots if item["captured_at"]), key=lambda item: item["captured_at"])
    events: list[dict[str, Any]] = []
    for previous, current in reversed(list(zip(known, known[1:], strict=False))):
        for direction, prefix in (("followers", "follower"), ("following", "following")):
            if previous[direction] is None or current[direction] is None:
                continue
            before, after = set(previous[direction]), set(current[direction])
            changes = (
                ("added", after - before if _coverage(previous, direction)["complete"] else set()),
                ("removed", before - after if _coverage(current, direction)["complete"] else set()),
            )
            for change, usernames in changes:
                for username in sorted(usernames):
                    event_type = f"{prefix}_observed_{change}"
                    events.append({
                        "id": _digest([previous["id"], current["id"], event_type, username]),
                        "ts": current["captured_at"], "type": event_type, "username": username,
                        "full_name": None, "delta": None, "source": "export_observation",
                        "evidence": "observed", "observed": True,
                        "previous_captured_at": previous["captured_at"],
                    })
                    if len(events) >= MAX_EVENTS:
                        return events
    return events


def _view(state: dict[str, Any]) -> dict[str, Any]:
    result = _empty()
    snapshot = next(item for item in state["snapshots"] if item["id"] == state["current"])
    coverage = {direction: _coverage(snapshot, direction) for direction in _DIRECTIONS}
    followers, following = set(snapshot["followers"] or []), set(snapshot["following"] or [])
    accounts = []
    for username in sorted(followers | following):
        outbound = True if username in following else False if coverage["following"]["complete"] else None
        inbound = True if username in followers else False if coverage["followers"]["complete"] else None
        accounts.append({
            "id": username, "username": username, "full_name": "", "is_private": None,
            "is_verified": None, "following": outbound, "followed_by": inbound,
            "relationship": _relationship(outbound, inbound), "updated_at": snapshot["captured_at"],
            "identity_basis": "username", "evidence": "export_observation",
        })
    captured = snapshot["captured_at"]
    stale = captured is None or datetime.now(UTC) - datetime.fromisoformat(captured) > timedelta(hours=36)
    labels = [
        f"{direction} " + ("user-declared complete" if coverage[direction]["complete"] else "partial" if coverage[direction]["present"] else "missing")
        for direction in _DIRECTIONS
    ]
    result.update({
        "username": state["account"], "snapshot_id": snapshot["id"], "stale": stale,
        "status": "degraded" if not all(item["complete"] for item in coverage.values()) else "stale" if stale else "ok",
        "last_success_at": captured,
        "last_attempt_at": max(item["imported_at"] for item in state["snapshots"]),
        "last_import_at": max(item["imported_at"] for item in state["snapshots"]),
        "coverage": "; ".join(labels), "coverage_details": coverage, "accounts": accounts,
        "events": _events(state["snapshots"]),
        "metrics": {
            "followers": len(followers) if coverage["followers"]["complete"] else None,
            "following": len(following) if coverage["following"]["complete"] else None,
            "mutuals": len(followers & following) if all(item["present"] for item in coverage.values()) else None,
            "not_following_back": sum(item["relationship"] == "not_following_back" for item in accounts) if coverage["followers"]["complete"] and coverage["following"]["present"] else None,
            "followers_observed": len(followers) if coverage["followers"]["present"] else None,
            "following_observed": len(following) if coverage["following"]["present"] else None,
            "reciprocal_unknown": sum(item["following"] is True and item["followed_by"] is None for item in accounts) if coverage["following"]["present"] else None,
            "unattributed_balance": None,
        },
    })
    result["provenance"]["capture_time_basis"] = "user_declared" if captured else "unknown"
    for item in sorted(state["snapshots"], key=lambda item: (item["imported_at"], item["id"]), reverse=True):
        result["runs"].append({
            "id": item["id"], "ts": item["captured_at"] or item["imported_at"],
            "finished_at": item["imported_at"], "captured_at": item["captured_at"],
            "imported_at": item["imported_at"], "source": "instagram_export",
            "status": "ok" if all(_coverage(item, direction)["complete"] for direction in _DIRECTIONS) else "degraded",
            "followers": len(item["followers"]) if _coverage(item, "followers")["complete"] else None,
            "following": len(item["following"]) if _coverage(item, "following")["complete"] else None,
            "coverage": "User-supplied export observation", "error_kind": None,
        })
    if captured is None:
        result["issues"].append({"code": "capture_time_unknown", "message": "The export capture time is unknown; relationship timestamps are not snapshot dates."})
    for direction, item in coverage.items():
        if not item["complete"]:
            result["issues"].append({"code": f"{direction}_coverage_unknown", "message": f"The {direction} export is missing or not declared complete with a known capture time; missing relationships remain unknown."})
    result["issues"].append({"code": "username_identity", "message": "Exports identify usernames, so a username change cannot be proven to be a new person or a removed relationship."})
    return result


def import_files(
    files: dict[str, bytes], workspace: Path, *, account: str,
    captured_at: str | None = None, complete_followers: bool = False,
    complete_following: bool = False,
) -> dict[str, Any]:
    """Import uploaded content without accepting a filesystem path from a browser.

    Limits apply to both compressed input and recognized uncompressed members.
    Complete means user-declared, present, contiguous and explicitly dated.
    """
    account = _handle(account)
    captured_at = _capture(captured_at)
    _local_path(workspace)
    if type(complete_followers) is not bool or type(complete_following) is not bool:
        raise ValueError("Completeness declarations must be booleans.")
    values, shards = _parse_files(files, account)
    state, receipt = _store(workspace, account, values, shards, captured_at, complete_followers, complete_following)
    result = _view(state)
    result["import_result"] = receipt
    return result


def import_export(
    source: Path, workspace: Path, *, account: str,
    captured_at: str | None = None, complete_followers: bool = False,
    complete_following: bool = False,
) -> dict[str, Any]:
    """Read one local ZIP, JSON file, or standard Instagram export directory.

    Directory discovery is limited to the selected directory and the two known
    relationship subdirectories. Unrelated export content is never opened.
    """
    source = _local_path(source)
    _local_path(workspace)
    payload: dict[str, bytes] = {}
    if source.is_dir():
        count = 0
        total = 0
        for directory in (source, source / "followers_and_following", source / "connections" / "followers_and_following"):
            directory = _local_path(directory)
            if not directory.is_dir():
                continue
            for path in directory.iterdir():
                count += 1
                if count > MAX_FILES:
                    raise ValueError("The export directory contains too many entries for the import limit.")
                if not _MEMBER.fullmatch(path.name):
                    continue
                content = _read_file(path, MAX_FILE_BYTES)
                total += len(content)
                if total > MAX_INPUT_BYTES:
                    raise ValueError("The export exceeds the import size limit.")
                payload[path.relative_to(source).as_posix()] = content
    elif source.suffix.lower() == ".zip" or _MEMBER.fullmatch(source.name):
        payload[source.name] = _read_file(source, MAX_INPUT_BYTES if source.suffix.lower() == ".zip" else MAX_FILE_BYTES)
    else:
        raise ValueError("Select a relationship JSON file, export folder, or ZIP.")
    return import_files(
        payload, workspace, account=account, captured_at=captured_at,
        complete_followers=complete_followers, complete_following=complete_following,
    )


def load_personal(workspace: Path) -> dict[str, Any]:
    """Return a sanitized personal view without creating or modifying a workspace."""
    result = _empty()
    try:
        state = _state(workspace)
        if state is None:
            result["issues"].append({"code": "personal_missing", "message": "Import your own Instagram relationship export to begin."})
            return result
        return _view(state)
    except (OSError, ValueError, TypeError, AttributeError, RecursionError):
        result["status"] = "error"
        result["issues"].append({"code": "personal_unreadable", "message": "The personal workspace could not be read safely."})
        return result
