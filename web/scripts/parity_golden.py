"""Generate cross-language parity vectors from the real Python implementation.

The TypeScript domain port in ``web/src/domain`` is pinned to this output: the
test ``web/tests/parity/parity.test.ts`` replays every case and expects the same
result or the same error message.

Run from the repository root (never plain ``uv run``, it writes into the tree):

    uv run --no-project --isolated --python <CPython 3.13> \
        --with 'platformdirs>=4.3,<5' --with 'instaloader>=4.15.3,<5' \
        python web/scripts/parity_golden.py web/tests/parity/golden.json

Determinism notes:

* Time. ``orbit_os.personal`` and ``orbitdiff.providers.fixture`` read the clock
  through their module attribute ``datetime``. This script replaces that
  attribute with a subclass whose ``now()`` returns a fixed instant, so capture
  time, stale, and import time results never depend on the wall clock.
* Limits. Cases that need a small bound set the module constants (``MAX_FILES``
  and friends) for the duration of the case and record the active values.
* Archives. Most ZIP inputs are assembled byte by byte here, including DEFLATE
  streams written bit by bit (``Bits``) so that each zlib rule can be broken on
  purpose. A few are written by ``zipfile`` or ``zlib`` with DEFLATE and
  therefore depend on the zlib build (reference: zlib 1.2.12). The file is only
  comparable across machines with the same CPython minor version and an
  equivalent zlib.
* DEFLATE acceptance. ``archives.cases`` holds members whose size and CRC-32
  are honest while the stream breaks one zlib rule, and ``archives.mutations``
  holds every single-byte change to the DEFLATE data of four members. Python
  rejects streams that still decode to the right bytes; the port must agree.
* Only synthetic handles are used.
"""

from __future__ import annotations

import io
import json
import sqlite3
import struct
import sys
import tempfile
import warnings
import zipfile
import zlib
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from orbit_os import personal  # noqa: E402
from orbitdiff.diff import EdgeState, reconcile  # noqa: E402
from orbitdiff.models import Account, Collection  # noqa: E402
from orbitdiff.providers import fixture as fixture_module  # noqa: E402
from orbitdiff.providers.base import ProviderError, validate_collection  # noqa: E402
from orbitdiff.store import GraphStore  # noqa: E402

CLOCK = datetime(2026, 9, 30, 12, 0, 0, tzinfo=UTC)
ACCOUNT = "atlas_studio"
REGULAR = 0o100644 << 16


class FixedClock(datetime):
    """Stands in for ``datetime`` inside the modules under test."""

    fixed = CLOCK

    @classmethod
    def now(cls, tz: Any = None) -> datetime:  # type: ignore[override]
        return cls.fixed if tz is None else cls.fixed.astimezone(tz)


def stamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="seconds")


def attempt(function: Callable[..., Any], *args: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        return {"ok": function(*args, **kwargs)}
    except (ValueError, ProviderError) as error:
        return {"error": str(error)}


def blob(payload: bytes) -> dict[str, str]:
    """Bytes as printable ASCII text when possible, otherwise hex."""
    if all(32 <= byte < 127 or byte == 10 for byte in payload):
        return {"text": payload.decode("ascii")}
    return {"hex": payload.hex()}


LIMIT_NAMES = {
    "maxFileBytes": "MAX_FILE_BYTES",
    "maxInputBytes": "MAX_INPUT_BYTES",
    "maxFiles": "MAX_FILES",
    "maxAccounts": "MAX_ACCOUNTS",
}
OTHER_BOUNDS = {"maxSnapshots": "MAX_SNAPSHOTS", "maxEvents": "MAX_EVENTS"}


@contextmanager
def bounds(**overrides: int) -> Iterator[dict[str, int]]:
    """Set module limits for one case and report the export limits in force."""
    names = {**LIMIT_NAMES, **OTHER_BOUNDS}
    saved = {constant: getattr(personal, constant) for constant in names.values()}
    try:
        for key, value in overrides.items():
            setattr(personal, names[key], value)
        yield {key: getattr(personal, constant) for key, constant in LIMIT_NAMES.items()}
    finally:
        for constant, value in saved.items():
            setattr(personal, constant, value)


# --------------------------------------------------------------------------- handles


def handle_cases() -> list[dict[str, Any]]:
    values: list[tuple[str, Any]] = [
        ("mixed case lowercases", "Atlas_Studio"),
        ("already lowercase", "atlas_studio"),
        ("all uppercase", "NOVA_LABS"),
        ("digits and punctuation", "A.B_c9"),
        ("single digit", "0"),
        ("single underscore", "_"),
        ("thirty characters", "a" * 30),
        ("thirty one characters", "a" * 31),
        ("empty", ""),
        ("one dot", "."),
        ("two dots", ".."),
        ("three dots", "..."),
        ("leading dot", ".a"),
        ("trailing dot", "a."),
        ("double dot inside", "a..b"),
        ("leading space", " atlas_studio"),
        ("trailing space", "atlas_studio "),
        ("trailing newline", "atlas_studio\n"),
        ("leading no-break space", "\u00a0atlas_studio"),
        ("at sign", "@atlas_studio"),
        ("two at signs", "@@atlas_studio"),
        ("hyphen", "bad-name"),
        ("inner space", "has space"),
        ("accented letter", "caf\u00e9"),
        ("kelvin sign", "\u212aelvin"),
        ("fullwidth letter", "\uff41tlas"),
        ("profile url", "https://www.instagram.com/atlas_studio/"),
        ("number", 5),
        ("null", None),
        ("boolean", True),
        ("list", ["atlas_studio"]),
        ("object", {"username": "atlas_studio"}),
    ]
    return [{"name": name, "value": value, **attempt(personal._handle, value)} for name, value in values]


# --------------------------------------------------------------------------- capture time


def capture_cases() -> dict[str, Any]:
    shared: list[tuple[str, Any]] = [
        ("null stays null", None),
        ("zulu", "2026-09-01T12:00:00Z"),
        ("explicit utc offset", "2026-09-01T12:00:00+00:00"),
        ("negative zero offset", "2026-09-01T12:00:00-00:00"),
        ("positive offset", "2026-09-01T14:00:00+02:00"),
        ("offset without colon", "2026-09-01T12:00:00-0500"),
        ("positive offset without colon", "2026-09-01T12:00:00+0530"),
        ("fraction truncated", "2026-09-01T12:00:00.987654Z"),
        ("one fraction digit", "2026-09-01T12:00:00.5Z"),
        ("milliseconds", "2026-09-01T12:00:00.000Z"),
        ("seven fraction digits", "2026-09-01T12:00:00.1234567Z"),
        ("fraction with offset", "2026-09-01T12:00:00.5+02:00"),
        ("space separator", "2026-09-01 12:00:00+00:00"),
        ("basic format", "20260901T120000Z"),
        ("basic date extended time", "20260901T12:00:00Z"),
        ("extended date basic time", "2026-09-01T120000Z"),
        ("basic time with fraction", "2026-09-01T120000.5Z"),
        ("no seconds", "2026-09-01T12:00Z"),
        ("no seconds basic", "2026-09-01T1200Z"),
        ("no seconds with offset", "2026-09-01T12:00+02:00"),
        ("no seconds basic with basic offset", "2026-09-01T1200+0200"),
        ("largest offset", "2026-09-01T12:00:00+23:59"),
        ("smallest offset", "2026-09-01T12:00:00-23:59"),
        ("leap day", "2024-02-29T12:00:00Z"),
        ("year one moved forward", "0001-01-01T00:00:00-00:01"),
        ("forty characters", "2026-09-01T12:00:00.12345678901234+00:00"),
        ("exactly five minutes ahead", "2026-09-30T12:05:00Z"),
        ("exactly five minutes ahead with offset", "2026-09-30T14:05:00+02:00"),
        ("one second past the tolerance", "2026-09-30T12:05:01Z"),
        ("one microsecond past the tolerance", "2026-09-30T12:05:00.000001Z"),
        ("far future", "2999-01-01T00:00:00Z"),
        ("forty one characters", "2026-09-01T12:00:00.123456789012345+00:00"),
        ("forty code points with astral characters", "2026-09-01T12:00:00Z" + "\U0001f600" * 20),
        ("forty one code points with astral characters", "2026-09-01T12:00:00Z" + "\U0001f600" * 21),
        ("no offset", "2026-09-01T12:00:00"),
        ("date only", "2026-09-01"),
        ("garbage", "not-a-date"),
        ("empty string", ""),
        ("number", 5),
        ("boolean", True),
        ("list", []),
        ("lowercase zulu", "2026-09-01T12:00:00z"),
        ("hour twenty four", "2026-09-01T24:00:00Z"),
        ("second sixty", "2026-09-01T23:59:60Z"),
        ("minute sixty", "2026-09-01T12:60:00Z"),
        ("february thirtieth", "2026-02-30T12:00:00Z"),
        ("leap day in a common year", "2026-02-29T12:00:00Z"),
        ("month thirteen", "2026-13-01T12:00:00Z"),
        ("month zero", "2026-00-01T12:00:00Z"),
        ("day zero", "2026-09-00T12:00:00Z"),
        ("year zero", "0000-01-01T00:00:00Z"),
        ("year one moved before the minimum", "0001-01-01T00:00:00+00:01"),
        ("offset of a full day", "2026-09-01T12:00:00+24:00"),
        ("negative offset of a full day", "2026-09-01T12:00:00-24:00"),
        ("offset hour ninety nine", "2026-09-01T12:00:00+99:00"),
        ("offset twenty three sixty", "2026-09-01T12:00:00+23:60"),
        ("trailing space", "2026-09-01T12:00:00Z "),
        ("leading space", " 2026-09-01T12:00:00Z"),
        ("one digit offset hour", "2026-09-01T12:00:00+2:00"),
        ("one digit month", "2026-9-1T12:00:00Z"),
        ("one digit minute", "2026-09-01T12:0:00Z"),
        ("ordinal date", "2026-244T12:00:00Z"),
        ("unicode minus", "2026-09-01T12:00:00\u221202:00"),
        ("fullwidth digits", "\uff12\uff10\uff12\uff16-09-01T12:00:00Z"),
        ("arabic digits in offset", "2026-09-01T12:00:00+\u0660\u0662:00"),
        ("character after zulu", "2026-09-01T12:00:00Z0"),
        ("double separator", "2026-09-01TT12:00:00Z"),
        ("double zulu", "2026-09-01T12:00:00ZZ"),
        ("sign without offset", "2026-09-01T12:00:00+"),
        ("offset minute one digit", "2026-09-01T12:00:00+02:0"),
        ("offset with dangling colon", "2026-09-01T12:00:00+02:"),
    ]
    python_only: list[tuple[str, str]] = [
        ("lowercase t separator", "2026-09-01t12:00:00Z"),
        ("underscore separator", "2026-09-01_12:00:00Z"),
        ("newline separator", "2026-09-01\n12:00:00Z"),
        ("hour only", "2026-09-01T12Z"),
        ("comma fraction", "2026-09-01T12:00:00,5Z"),
        ("fraction without digits", "2026-09-01T12:00:00.Z"),
        ("space before zulu", "2026-09-01T12:00:00 Z"),
        ("hour only offset", "2026-09-01T12:00:00+02"),
        ("offset with seconds", "2026-09-01T12:00:00+02:00:30"),
        ("offset with fractional seconds", "2026-09-01T12:00:00+02:00:30.5"),
        ("basic offset with seconds", "2026-09-01T12:00:00+020030"),
        ("offset minute ninety nine", "2026-09-01T12:00:00+00:99"),
        ("offset minute sixty", "2026-09-01T12:00:00+00:60"),
        ("week date", "2026-W36-2T12:00:00Z"),
        ("basic week date", "2026W362T120000Z"),
    ]
    stricter = [{"name": name, "value": value, **attempt(personal._capture, value)} for name, value in python_only]
    for item in stricter:
        if "ok" not in item:
            raise SystemExit(f"expected Python to accept capture form: {item['name']}")
    return {
        "now": stamp(CLOCK),
        "cases": [{"name": name, "value": value, **attempt(personal._capture, value)} for name, value in shared],
        "python_only": stricter,
    }


# --------------------------------------------------------------------------- member paths


def describe_member(name: Any) -> dict[str, Any]:
    path = personal._member_path(name)
    recognized = personal._recognized(path)
    return {
        "path": str(path),
        "parent": str(path.parent),
        "recognized": list(recognized) if recognized else None,
    }


def member_cases() -> list[dict[str, Any]]:
    long_ok = "/".join(["a" * 255, "a" * 255, "a" * 255, "a" * 254, "b"])
    values: list[tuple[str, Any]] = [
        ("followers shard one", "followers_1.json"),
        ("followers without suffix", "followers.json"),
        ("following without suffix", "following.json"),
        ("following shard twelve", "following_12.json"),
        ("highest shard", "followers_9999.json"),
        ("shard ten thousand is ignored", "followers_10000.json"),
        ("leading zero shard is ignored", "followers_01.json"),
        ("shard zero suffix is ignored", "followers_0.json"),
        ("capital letter is ignored", "Followers_1.json"),
        ("capital extension is ignored", "followers_1.JSON"),
        ("unrelated json is ignored", "pending_follow_requests.json"),
        ("trailing slash is stripped", "followers_1.json/"),
        ("standard nested location", "connections/followers_and_following/followers_1.json"),
        ("short nested location", "followers_and_following/following.json"),
        ("other parent is ignored", "export/followers_1.json"),
        ("grandparent does not count", "followers_and_following/more/followers_1.json"),
        ("non ascii parent is ignored", "na\u00efve/followers_1.json"),
        ("parent traversal", "../followers_1.json"),
        ("inner parent traversal", "a/../followers_1.json"),
        ("leading slash", "/followers_1.json"),
        ("drive letter", "C:/followers_1.json"),
        ("backslash", "a\\followers_1.json"),
        ("empty segment", "a//followers_1.json"),
        ("dot segment", "./followers_1.json"),
        ("inner dot segment", "a/./followers_1.json"),
        ("control character", "con\u0001trol/followers_1.json"),
        ("delete character", "del\u007f.json"),
        ("trailing newline", "followers_1.json\n"),
        ("sixteen segments", "/".join(["d"] * 15 + ["followers_1.json"])),
        ("seventeen segments", "/".join(["d"] * 16 + ["followers_1.json"])),
        ("segment of 255 characters", "a" * 255 + "/followers_1.json"),
        ("segment of 256 characters", "a" * 256 + "/followers_1.json"),
        ("name of 1024 characters", long_ok),
        ("name of 1025 characters", long_ok + "b"),
        ("1024 astral code points", "\U0001f600" * 1024),
        ("segment of 255 astral code points", "\U0001f600" * 255 + "/followers_1.json"),
        ("segment of 256 astral code points", "\U0001f600" * 256 + "/followers_1.json"),
        ("empty name", ""),
        ("only a slash", "/"),
        ("dot env segment", ".env/followers_1.json"),
        ("dot env uppercase", ".ENV"),
        ("dot env with suffix", ".env.local/followers_1.json"),
        ("dot env mixed case suffix", "a/.Env.Production/b"),
        ("dot ssh segment", ".ssh/followers_1.json"),
        ("dot ssh uppercase inner", "a/.SSH/b"),
        ("envrc is not protected", ".envrc/followers_1.json"),
        ("env suffix is not protected", "x.env/followers_and_following/followers_1.json"),
        ("number", 5),
        ("null", None),
    ]
    return [{"name": name, "value": value, **attempt(describe_member, value)} for name, value in values]


# --------------------------------------------------------------------------- export files


def roster(*handles: str, following: bool = False, href: bool = True) -> bytes:
    rows = [
        {
            "title": handle if following else "",
            "media_list_data": [],
            "string_list_data": [
                {
                    **({"href": f"https://www.instagram.com/{handle}/"} if href else {}),
                    **({} if following else {"value": handle}),
                    "timestamp": 1600000000,
                }
            ],
        }
        for handle in handles
    ]
    return json.dumps({"relationships_following": rows} if following else rows).encode()


def row(record: dict[str, Any], **extra: Any) -> bytes:
    """One follower row wrapped in a top-level array."""
    return json.dumps([{"string_list_data": [record], **extra}]).encode()


def parse(files: dict[str, bytes], account: str) -> dict[str, Any]:
    values, shards = personal._parse_files(files, personal._handle(account))
    return {"values": values, "shards": shards}


def parse_case(name: str, files: dict[str, bytes], account: str = ACCOUNT, **limits: int) -> dict[str, Any]:
    with bounds(**limits) as active, warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return {
            "name": name,
            "account": account,
            "limits": active,
            "files": [{"name": key, **blob(value)} for key, value in files.items()],
            **attempt(parse, files, account),
        }


def layout_cases() -> list[dict[str, Any]]:
    one = roster("nova_labs")
    two = roster("pixel_forge", "nova_labs")
    out = roster("nova_labs", "pixel_forge", following=True)
    nested = "connections/followers_and_following/"
    cases = [
        parse_case("two follower shards and following at the root", {"followers_1.json": one, "followers_2.json": two, "following.json": out}),
        parse_case("shard gap", {"followers_1.json": one, "followers_3.json": two}),
        parse_case("lone second shard", {"followers_2.json": one}),
        parse_case("unsuffixed followers file", {"followers.json": one}),
        parse_case("numbered following file", {"following_1.json": out}),
        parse_case("shards are reported sorted", {"followers_3.json": one, "followers_1.json": two, "followers_2.json": one}),
        parse_case("unsuffixed then numbered overlaps", {"followers.json": one, "followers_1.json": two}),
        parse_case("numbered then unsuffixed overlaps", {"followers_1.json": one, "followers.json": two}),
        parse_case("same shard through a trailing slash alias", {"followers_1.json": one, "followers_1.json/": two}),
        parse_case("ignored names next to a recognized file", {
            "followers_01.json": b"not json", "Followers_1.json": b"not json", "followers_10000.json": b"not json",
            "pending_follow_requests.json": b"not json", "followers_1.json": one,
        }),
        parse_case("standard nested folder", {nested + "followers_1.json": one, nested + "following.json": out}),
        parse_case("short nested folder", {"followers_and_following/followers_1.json": one}),
        parse_case("other parent is not recognized", {"export/followers_1.json": one}),
        parse_case("root file plus nested file", {"followers_1.json": one, nested + "following.json": out}),
        parse_case("two export folders", {"one/" + nested + "followers_1.json": one, "two/" + nested + "following.json": out}),
        parse_case("only unrelated files", {"messages.json": b"[]", "notes.txt": b"hello"}),
        parse_case("empty upload", {}),
        parse_case("parent traversal name", {"../followers_1.json": one}),
        parse_case("absolute name", {"/followers_1.json": one}),
        parse_case("drive letter name", {"C:/followers_1.json": one}),
        parse_case("backslash name", {"a\\followers_1.json": one}),
        parse_case("unsafe unrelated name rejects the upload", {"followers_1.json": one, "notes/../x.txt": b"x"}),
        parse_case("protected unrelated name rejects the upload", {"followers_1.json": one, ".env": b"x"}),
        parse_case("zip next to another file", {"export.zip": b"PK", "followers_1.json": one}),
        parse_case("two zip files", {"one.zip": b"PK", "two.ZIP": b"PK"}),
        parse_case("zip that is not an archive", {"export.zip": b"not a zip"}),
        parse_case("uppercase zip extension is an archive", {"EXPORT.ZIP": b"not a zip"}),
        parse_case("three files with a limit of two", {"a.txt": b"", "b.txt": b"", "followers_1.json": one}, maxFiles=2),
        parse_case("upload above the input limit", {"notes.txt": b"x" * 40, "followers_1.json": b"[]"}, maxInputBytes=41),
        parse_case("recognized file above the file limit", {"followers_1.json": b" " * 65}, maxFileBytes=64),
        parse_case("unrelated file above the file limit is ignored", {"notes.txt": b" " * 65, "followers_1.json": b"[]"}, maxFileBytes=64),
        parse_case("more rows than the account limit", {"followers_1.json": roster("nova_labs", "pixel_forge", "lunar_arch")}, maxAccounts=2),
        parse_case("total handles above the account limit", {"followers_1.json": two, "following.json": roster("lunar_arch", "ember_lab", following=True)}, maxAccounts=3),
        parse_case("same handle in both directions counts twice", {"followers_1.json": two, "following.json": out}, maxAccounts=3),
        parse_case("selected account is normalized", {"followers_1.json": json.dumps({"account": "atlas_studio", "relationships_followers": []}).encode()}, account="Atlas_Studio"),
        parse_case("selected account must be a handle", {"followers_1.json": one}, account="not a handle"),
    ]
    return cases


def shape_cases() -> list[dict[str, Any]]:
    def doc(value: Any) -> bytes:
        return json.dumps(value).encode()

    record = {"value": "nova_labs"}
    cases = [
        parse_case("followers array and following object", {"followers_1.json": roster("nova_labs", "lunar_arch"), "following.json": roster("nova_labs", "pixel_forge", following=True)}),
        parse_case("followers in object form", {"followers_1.json": doc({"relationships_followers": json.loads(roster("nova_labs"))})}),
        parse_case("following file with a bare array", {"following.json": roster("nova_labs")}),
        parse_case("title and value agree in different case", {"followers_1.json": row({"value": "Nova_Labs"}, title="NOVA_LABS")}),
        parse_case("title and value conflict", {"followers_1.json": row({"value": "nova_labs"}, title="pixel_forge")}),
        parse_case("empty record list", {"followers_1.json": doc([{"string_list_data": []}])}),
        parse_case("two records", {"followers_1.json": doc([{"string_list_data": [record, record]}])}),
        parse_case("records not a list", {"followers_1.json": doc([{"string_list_data": record}])}),
        parse_case("record not an object", {"followers_1.json": doc([{"string_list_data": ["nova_labs"]}])}),
        parse_case("row without records", {"followers_1.json": doc([{}])}),
        parse_case("row not an object", {"followers_1.json": doc(["nova_labs"])}),
        parse_case("document null", {"followers_1.json": b"null"}),
        parse_case("document empty object", {"followers_1.json": b"{}"}),
        parse_case("document string", {"followers_1.json": b'"nova_labs"'}),
        parse_case("document number", {"followers_1.json": b"7"}),
        parse_case("document true", {"followers_1.json": b"true"}),
        parse_case("object with the other direction key", {"followers_1.json": roster("nova_labs", following=True)}),
        parse_case("present empty list", {"followers_1.json": b"[]"}),
        parse_case("present empty list and a full direction", {"followers_1.json": b"[]", "following.json": roster("nova_labs", following=True)}),
        parse_case("duplicate rows and case variants collapse", {"followers_1.json": doc([{"string_list_data": [{"value": name}]} for name in ("Nova_Labs", "nova_labs", "NOVA_LABS", "pixel_forge")])}),
        parse_case("rows are returned sorted", {"followers_1.json": roster("pixel_forge", "atlas_studio", "nova_labs", "ember_lab")}),
        parse_case("shards of one direction are merged", {"followers_1.json": roster("nova_labs"), "followers_2.json": roster("pixel_forge", "nova_labs")}),
        parse_case("empty value falls back to title", {"followers_1.json": row({"value": ""}, title="nova_labs")}),
        parse_case("zero value falls back to title", {"followers_1.json": row({"value": 0}, title="nova_labs")}),
        parse_case("empty list value falls back to title", {"followers_1.json": row({"value": []}, title="nova_labs")}),
        parse_case("empty object value falls back to title", {"followers_1.json": row({"value": {}}, title="nova_labs")}),
        parse_case("false value falls back to title", {"followers_1.json": row({"value": False}, title="nova_labs")}),
        parse_case("null value and null title", {"followers_1.json": row({"value": None}, title=None)}),
        parse_case("no value and no title", {"followers_1.json": row({})}),
        parse_case("string zero is a handle", {"followers_1.json": row({"value": "0"})}),
        parse_case("number value is not a handle", {"followers_1.json": row({"value": 5}, title="nova_labs")}),
        parse_case("not a number literal value is truthy", {"followers_1.json": b'[{"title":"nova_labs","string_list_data":[{"value":NaN}]}]'}),
        parse_case("not a number literal in an unread field", {"followers_1.json": b'[{"string_list_data":[{"value":"nova_labs","timestamp":NaN}],"score":-Infinity}]'}),
        parse_case("number title with a value", {"followers_1.json": row({"value": "nova_labs"}, title=5)}),
        parse_case("list title with a value", {"followers_1.json": row({"value": "nova_labs"}, title=["nova_labs"])}),
        parse_case("empty list title is ignored", {"followers_1.json": row({"value": "nova_labs"}, title=[])}),
        parse_case("invalid handle value", {"followers_1.json": row({"value": "bad-name"})}),
        parse_case("row timestamps are not read", {"followers_1.json": row({"value": "nova_labs", "timestamp": "never read"}, media_list_data=[{"x": 1}])}),
        parse_case("duplicate json key", {"followers_1.json": b'[{"string_list_data":[{"value":"nova_labs","value":"nova_labs"}]}]'}),
        parse_case("duplicate json key through an escape", {"followers_1.json": b'[{"string_list_data":[{"value":"nova_labs","\\u0076alue":"nova_labs"}]}]'}),
        parse_case("invalid utf-8", {"followers_1.json": b'[{"string_list_data":[{"value":"nova_labs\xff"}]}]'}),
        parse_case("truncated json", {"followers_1.json": roster("nova_labs")[:-3]}),
        parse_case("byte order mark", {"followers_1.json": b"\xef\xbb\xbf" + roster("nova_labs")}),
        parse_case("utf-16 document", {"followers_1.json": roster("nova_labs").decode().encode("utf-16")}),
        parse_case("deeply nested unread field", {"followers_1.json": b'[{"string_list_data":[{"value":"nova_labs"}],"extra":' + b"[" * 100 + b"]" * 100 + b"}]"}),
    ]
    for field in ("account", "username", "owner"):
        cases += [
            parse_case(f"owner under {field} matches", {"followers_1.json": doc({field: "atlas_studio", "relationships_followers": []})}),
            parse_case(f"owner under {field} matches in another case", {"followers_1.json": doc({field: "Atlas_Studio", "relationships_followers": []})}),
            parse_case(f"owner object under {field} matches", {"followers_1.json": doc({field: {"username": "atlas_studio"}, "relationships_followers": []})}),
            parse_case(f"owner under {field} differs", {"followers_1.json": doc({field: "nova_labs", "relationships_followers": []})}),
            parse_case(f"owner object under {field} differs", {"followers_1.json": doc({field: {"username": "nova_labs"}, "relationships_followers": []})}),
            parse_case(f"owner under {field} is null", {"followers_1.json": doc({field: None, "relationships_followers": []})}),
            parse_case(f"owner object under {field} has no username", {"followers_1.json": doc({field: {}, "relationships_followers": []})}),
            parse_case(f"owner under {field} is not a handle", {"followers_1.json": doc({field: "not a handle", "relationships_followers": []})}),
        ]
    cases.append(parse_case("owner is checked before the list shape", {"followers_1.json": doc({"owner": "nova_labs"})}))
    cases.append(parse_case("owner keys in an array document are rows", {"followers_1.json": doc([{"account": "nova_labs"}])}))
    return cases


def href_cases() -> list[dict[str, Any]]:
    base = "https://www.instagram.com/"
    values: list[tuple[str, Any]] = [
        ("www host", base + "nova_labs"),
        ("bare host with trailing slash", "https://instagram.com/nova_labs/"),
        ("http scheme", "http://www.instagram.com/nova_labs/"),
        ("uppercase scheme", "HTTPS://www.instagram.com/nova_labs"),
        ("underscore u prefix", base + "_u/nova_labs"),
        ("underscore u prefix with slashes", base + "_u//nova_labs/"),
        ("uppercase host and mixed case handle", "https://WWW.INSTAGRAM.COM/Nova_Labs/"),
        ("empty query", base + "nova_labs/?"),
        ("empty fragment", base + "nova_labs#"),
        ("empty query and fragment", base + "nova_labs?#"),
        ("double slashes", "https://www.instagram.com//nova_labs//"),
        ("many trailing slashes", base + "nova_labs///"),
        ("leading space", " " + base + "nova_labs"),
        ("leading control character", "\u0000" + base + "nova_labs"),
        ("newline inside the path", base + "nova\n_labs"),
        ("tab inside the scheme", "ht\ttps://www.instagram.com/nova_labs"),
        ("two hundred characters", base + "nova_labs" + "/" * (200 - len(base) - 9)),
        ("two hundred and one characters", base + "nova_labs" + "/" * (201 - len(base) - 9)),
        ("two hundred astral code points", base + "nova_labs" + "/" * (198 - len(base) - 9) + "?" + "\U0001f600"),
        ("query", base + "nova_labs/?hl=en"),
        ("fragment", base + "nova_labs#x"),
        ("port", "https://www.instagram.com:443/nova_labs"),
        ("empty port", "https://www.instagram.com:/nova_labs"),
        ("other subdomain", "https://m.instagram.com/nova_labs"),
        ("trailing dot host", "https://www.instagram.com./nova_labs"),
        ("ftp scheme", "ftp://www.instagram.com/nova_labs"),
        ("scheme relative", "//www.instagram.com/nova_labs"),
        ("no scheme", "www.instagram.com/nova_labs"),
        ("single slash after scheme", "https:/www.instagram.com/nova_labs"),
        ("other handle", base + "pixel_forge"),
        ("user info", "https://user@www.instagram.com/nova_labs"),
        ("empty user info", "https://@www.instagram.com/nova_labs"),
        ("post path", base + "p/nova_labs/"),
        ("repeated underscore u prefix", base + "_u/_u/nova_labs"),
        ("slash before underscore u", "https://www.instagram.com//_u/nova_labs"),
        ("trailing space", base + "nova_labs "),
        ("percent encoded handle", base + "%6eova_labs"),
        ("backslash host", "https://www.instagram.com\\nova_labs"),
        ("host only", "https://www.instagram.com"),
        ("query before the path", "https://www.instagram.com?x/nova_labs"),
        ("valid bracketed address", "https://[::1]/nova_labs"),
        ("bracketed future address", "https://[v1.x]/nova_labs"),
        ("unclosed bracket", "https://[::1/nova_labs"),
        ("unopened bracket", "https://::1]/nova_labs"),
        ("text before a bracket", "https://a[::1]/nova_labs"),
        ("text after a bracket", "https://[::1]x/nova_labs"),
        ("invalid future address", "https://[vx]/nova_labs"),
        ("host that normalizes to a slash", "https://www.instagram.com\u2100/nova_labs"),
        ("fullwidth slash in the host", "https://www.instagram.com\uff0fnova_labs"),
        ("fullwidth letter in the host", "https://www.inst\uff41gram.com/nova_labs"),
        ("kelvin sign in the host", "https://www.\u212anstagram.com/nova_labs"),
        ("empty string", ""),
        ("number", 5),
        ("boolean false", False),
        ("list", [base + "nova_labs"]),
        ("null is skipped", None),
    ]
    return [parse_case("href " + name, {"followers_1.json": row({"value": "nova_labs", "href": value})}) for name, value in values]


def message_only_rows() -> list[dict[str, Any]]:
    """Both sides reject these rows. Python reports the text of ipaddress."""
    values = [
        ("bracketed text that is not an address", "https://[x]/nova_labs"),
        ("bracketed ipv4 address", "https://[1.2.3.4]/nova_labs"),
    ]
    cases = [parse_case("href " + name, {"followers_1.json": row({"value": "nova_labs", "href": value})}) for name, value in values]
    for item in cases:
        if "error" not in item:
            raise SystemExit(f"expected Python to reject: {item['name']}")
    return cases


# --------------------------------------------------------------------------- strict JSON


def tagged(value: Any) -> Any:
    """A JSON-safe rendering of a decoded Python value."""
    if value is None or isinstance(value, bool | str):
        return value
    if isinstance(value, int):
        return value if abs(value) <= 2**53 else {"$int": str(value)}
    if isinstance(value, float):
        if value != value:
            return {"$float": "nan"}
        if value in (float("inf"), float("-inf")):
            return {"$float": "inf" if value > 0 else "-inf"}
        return value
    if isinstance(value, list):
        return [tagged(item) for item in value]
    return {"$dict": [[key, tagged(item)] for key, item in value.items()]}


def decode(payload: bytes) -> Any:
    return tagged(personal._json(payload))


def nested(opening: bytes, closing: bytes, depth: int, core: bytes = b"") -> bytes:
    return opening * depth + core + closing * depth


def json_cases() -> dict[str, Any]:
    values: list[tuple[str, bytes]] = [
        ("empty input", b""),
        ("whitespace only", b" "),
        ("empty array", b"[]"),
        ("empty array with inner space", b"[ ]"),
        ("empty object", b"{}"),
        ("empty object with inner space", b"{ }"),
        ("literals", b"[true, false, null]"),
        ("mixed values", b'[1, 2.5, -3, 1e2, "x", null, true, false, {"k": []}]'),
        ("scalar string", b'"a"'),
        ("scalar number", b"1"),
        ("surrounding whitespace", b" \n\t\r[1] \n\t\r"),
        ("form feed is not whitespace", b"\x0c[1]"),
        ("vertical tab is not whitespace", b"\x0b[1]"),
        ("no-break space is not whitespace", b"\xc2\xa0[1]"),
        ("trailing null byte", b"[1]\x00"),
        ("trailing text", b"[1]x"),
        ("two documents", b"[1][2]"),
        ("byte order mark", b"\xef\xbb\xbf[]"),
        ("two byte order marks", b"\xef\xbb\xbf\xef\xbb\xbf[]"),
        ("trailing byte order mark", b"[]\xef\xbb\xbf"),
        ("not a number literal", b"NaN"),
        ("non finite literals in a list", b"[NaN, Infinity, -Infinity]"),
        ("lowercase nan", b"nan"),
        ("negative nan", b"-NaN"),
        ("truncated infinity", b"Infinit"),
        ("truncated negative infinity", b"-Infinit"),
        ("truncated true", b"tru"),
        ("capitalized true", b"True"),
        ("trailing comma in array", b"[1,]"),
        ("leading comma in array", b"[,1]"),
        ("trailing comma in object", b'{"a":1,}'),
        ("single quoted key", b"{'a':1}"),
        ("unquoted key", b"{a:1}"),
        ("number key", b"{1:2}"),
        ("missing comma", b"[1 2]"),
        ("missing colon", b'{"a" 1}'),
        ("missing value", b'{"a":}'),
        ("unterminated array", b"[1"),
        ("unterminated object", b'{"a":1'),
        ("unterminated string", b'"abc'),
        ("integer zero", b"0"),
        ("negative zero integer", b"-0"),
        ("negative zero float", b"-0.0"),
        ("leading zero", b"01"),
        ("plus sign", b"+1"),
        ("bare minus", b"-"),
        ("leading dot", b".5"),
        ("trailing dot", b"1."),
        ("exponent", b"1E5"),
        ("signed exponent", b"1e+5"),
        ("negative exponent", b"25e-1"),
        ("dangling exponent", b"1e"),
        ("dangling fraction exponent", b"1.5e"),
        ("overflowing exponent", b"1e400"),
        ("negative overflowing exponent", b"-1e400"),
        ("underflowing exponent", b"1e-400"),
        ("integer above double precision", b"12345678901234567890123"),
        ("integer of 4300 digits", b"1" * 4300),
        ("integer of 4301 digits", b"1" * 4301),
        ("negative integer of 4300 digits", b"-" + b"1" * 4300),
        ("negative integer of 4301 digits", b"-" + b"1" * 4301),
        ("float with a long integer part", b"1" * 5000 + b".5"),
        ("escaped accent", b'"\\u00e9"'),
        ("escaped surrogate pair", b'"\\ud83d\\ude00"'),
        ("escaped lone high surrogate", b'"\\ud83d"'),
        ("escaped reversed surrogates", b'"\\ude00\\ud83d"'),
        ("escaped high surrogate then letter", b'"\\uD83D\\u0041"'),
        ("short unicode escape", b'"\\u12"'),
        ("non hex unicode escape", b'"\\u12G4"'),
        ("unicode escape with a sign", b'"\\u+123"'),
        ("unknown escape", b'"\\x41"'),
        ("simple escapes", b'"\\"\\\\\\/\\b\\f\\n\\r\\t"'),
        ("raw tab in a string", b'"a\tb"'),
        ("raw newline in a string", b'"a\nb"'),
        ("raw delete in a string", b'"\x7f"'),
        ("utf-8 accent", b'"\xc3\xa9"'),
        ("utf-8 astral character", b'"\xf0\x9f\x98\x80"'),
        ("invalid start byte", b'"\xff"'),
        ("overlong encoding", b'"\xc0\xaf"'),
        ("code point above the range", b'"\xf4\x90\x80\x80"'),
        ("truncated multibyte sequence", b'"\xe2\x82"'),
        ("encoded lone surrogate", b'"\xed\xa0\x80"'),
        ("encoded surrogate pair", b'"\xed\xa0\xbd\xed\xb8\x80"'),
        ("duplicate key", b'{"a":1,"a":2}'),
        ("duplicate key in a nested object", b'{"a":{"b":1,"b":2}}'),
        ("same key in sibling objects", b'[{"a":1},{"a":2}]'),
        ("duplicate key through an escape", b'{"a":1,"\\u0061":2}'),
        ("duplicate empty key", b'{"":1,"":2}'),
        ("keys differing in case", b'{"a":1,"A":2}'),
        ("prototype key", b'{"__proto__":1,"constructor":2,"toString":3}'),
        ("numeric keys keep their values", b'{"2":"two","1":"one","10":"ten"}'),
        ("utf-16 with a byte order mark", "[1]".encode("utf-16")),
        ("utf-16 little endian", "[1]".encode("utf-16-le")),
        ("utf-16 big endian", "[1]".encode("utf-16-be")),
        ("utf-32 with a byte order mark", "[1]".encode("utf-32")),
        ("utf-32 little endian", "[1]".encode("utf-32-le")),
        ("utf-32 big endian", "[1]".encode("utf-32-be")),
        ("utf-16 accent", '["\u00e9"]'.encode("utf-16-le")),
        ("utf-16 astral character", '["\U0001f600"]'.encode("utf-16-le")),
        ("utf-16 lone surrogate", b'[\x00"\x00\x00\xd8"\x00]\x00'),
        ("utf-16 escape", b'"\x00\\\x00u\x000\x000\x004\x001\x00"\x00'),
        ("two bytes read as utf-16 little endian", b"1\x00"),
        ("two bytes read as utf-16 big endian", b"\x001"),
        ("one null byte", b"\x00"),
        ("three bytes stay utf-8", b"[\x00]"),
        ("utf-16 with an odd length", b"[\x001\x00]\x00\x00"),
        ("utf-16 byte order mark with an odd length", b"\xff\xfe[\x00]\x00\x00"),
        ("utf-32 byte order mark with a short tail", b"\xff\xfe\x00\x00[\x00\x00\x00]\x00\x00"),
        ("utf-32 surrogate code point", b"[\x00\x00\x00\x00\xd8\x00\x00]\x00\x00\x00"),
        ("utf-32 code point above the range", b"\x00\x00\x00[\x00\x11\x00\x00\x00\x00\x00]"),
    ]
    cases = [{"name": name, "input": blob(payload), **attempt(decode, payload)} for name, payload in values]
    depth_specs = [
        ("arrays nested 512 deep", "[", "]", 512, ""),
        ("objects nested 512 deep", '{"a":', "}", 512, "1"),
        ("arrays nested 200000 deep", "[", "]", 200000, ""),
        ("objects nested 200000 deep", '{"a":', "}", 200000, "1"),
    ]
    for name, opening, closing, depth, core in depth_specs:
        payload = nested(opening.encode(), closing.encode(), depth, core.encode())
        result = attempt(personal._json, payload)
        cases.append({
            "name": name,
            "input": {"nested": {"open": opening, "close": closing, "depth": depth, "core": core}},
            **({"ok": "accepted"} if "ok" in result else result),
        })
    python_only = []
    for name, opening, closing, depth, core in [
        ("arrays nested 513 deep", "[", "]", 513, ""),
        ("objects nested 513 deep", '{"a":', "}", 513, "1"),
    ]:
        result = attempt(personal._json, nested(opening.encode(), closing.encode(), depth, core.encode()))
        if "ok" not in result:
            raise SystemExit(f"expected Python to accept: {name}")
        python_only.append({
            "name": name,
            "input": {"nested": {"open": opening, "close": closing, "depth": depth, "core": core}},
            "ok": "accepted",
        })
    return {"cases": cases, "python_only": python_only}


# --------------------------------------------------------------------------- archives


@dataclass
class Entry:
    """One archive member with every header field open to tampering."""

    name: bytes
    data: bytes = b""
    method: int = 0
    flags: int = 0
    external: int = REGULAR
    system: int = 3
    version: int = 20
    payload: bytes | None = None
    crc: int | None = None
    size: int | None = None
    packed: int | None = None
    extra: bytes = b""
    comment: bytes = b""
    local_name: bytes | None = None
    local_flags: int | None = None
    local_extra: bytes = b""
    local_magic: bytes = b"PK\x03\x04"
    offset: int | None = None
    write_local: bool = True


def deflate(data: bytes) -> bytes:
    compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
    return compressor.compress(data) + compressor.flush()


def deflate_stored_block(data: bytes) -> bytes:
    """A raw DEFLATE stream made of one final stored block."""
    return b"\x01" + struct.pack("<HH", len(data), len(data) ^ 0xFFFF) + data


def deflate_fixed(data: bytes) -> bytes:
    """A raw DEFLATE stream of literals coded with the fixed Huffman table."""
    bits: list[int] = [1, 1, 0]
    for byte in data:
        code, width = (0x30 + byte, 8) if byte < 144 else (0x190 + byte - 144, 9)
        bits += [(code >> shift) & 1 for shift in range(width - 1, -1, -1)]
    bits += [0] * 7
    bits += [0] * (-len(bits) % 8)
    return bytes(sum(bit << index for index, bit in enumerate(bits[start:start + 8])) for start in range(0, len(bits), 8))


CODE_LENGTH_ORDER = (16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15)
REPEAT_WIDTHS = {16: 2, 17: 3, 18: 7}
DISTANCE_BASES = (1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577)


def huffman_codes(widths: dict[int, int]) -> dict[int, tuple[int, int]]:
    """The canonical code and width DEFLATE assigns to each symbol."""
    codes: dict[int, tuple[int, int]] = {}
    code = 0
    for width in range(1, 16):
        for symbol in sorted(symbol for symbol, size in widths.items() if size == width):
            codes[symbol] = (code, width)
            code += 1
        code <<= 1
    return codes


class Bits:
    """A raw DEFLATE stream assembled bit by bit, so that any rule can be broken on purpose."""

    def __init__(self) -> None:
        self.bits: list[int] = []
        self.codes: dict[int, tuple[int, int]] = {}

    def field(self, value: int, width: int) -> Bits:
        """A header or extra-bits field: least significant bit first."""
        self.bits += [(value >> index) & 1 for index in range(width)]
        return self

    def code(self, value: int, width: int) -> Bits:
        """A Huffman code: most significant bit first."""
        self.bits += [(value >> index) & 1 for index in range(width - 1, -1, -1)]
        return self

    def block(self, final: bool, kind: int) -> Bits:
        return self.field(int(final), 1).field(kind, 2)

    def fixed(self, *symbols: int) -> Bits:
        """Literal and length symbols coded with the fixed Huffman table."""
        for symbol in symbols:
            if symbol < 144:
                self.code(0x30 + symbol, 8)
            elif symbol < 256:
                self.code(0x190 + symbol - 144, 9)
            elif symbol < 280:
                self.code(symbol - 256, 7)
            else:
                self.code(0xC0 + symbol - 280, 8)
        return self

    def text(self, data: bytes) -> Bits:
        return self.fixed(*data)

    def distance(self, value: int) -> Bits:
        """A distance coded with the fixed table: a five bit code and its extra bits."""
        symbol = max(index for index, base in enumerate(DISTANCE_BASES) if base <= value)
        return self.code(symbol, 5).field(value - DISTANCE_BASES[symbol], max(0, symbol // 2 - 1))

    def dynamic(self, final: bool, literals: int, distances: int, widths: dict[int, int], count: int | None = None) -> Bits:
        """A dynamic block header up to and including the code length code."""
        used = max([4] + [CODE_LENGTH_ORDER.index(symbol) + 1 for symbol in widths]) if count is None else count
        self.block(final, 2).field(literals - 257, 5).field(distances - 1, 5).field(used - 4, 4)
        for symbol in CODE_LENGTH_ORDER[:used]:
            self.field(widths.get(symbol, 0), 3)
        self.codes = huffman_codes(widths)
        return self

    def lengths(self, *items: int | tuple[int, int]) -> Bits:
        """Code lengths written with the code length code; a pair is a repeat symbol and its count field."""
        for item in items:
            symbol, extra = item if isinstance(item, tuple) else (item, None)
            self.code(*self.codes[symbol])
            if extra is not None:
                self.field(extra, REPEAT_WIDTHS[symbol])
        return self

    def done(self) -> bytes:
        bits = self.bits + [0] * (-len(self.bits) % 8)
        return bytes(sum(bit << index for index, bit in enumerate(bits[start:start + 8])) for start in range(0, len(bits), 8))


def packed_bytes(entry: Entry) -> bytes:
    if entry.payload is not None:
        return entry.payload
    return deflate(entry.data) if entry.method == 8 else entry.data


def narrow(value: int) -> int:
    return min(value, 0xFFFFFFFF)


def build(
    entries: list[Entry], *, comment: bytes = b"", prefix: bytes = b"", between: bytes = b"",
    count: int | None = None, count_here: int | None = None, disk: int = 0, directory_disk: int = 0,
    directory_size: int | None = None, directory_offset: int | None = None, trailer: bytes = b"",
    declared_comment: int | None = None,
) -> bytes:
    body = bytearray()
    directory = bytearray()
    for entry in entries:
        payload = packed_bytes(entry)
        crc = zlib.crc32(entry.data) if entry.crc is None else entry.crc
        size = len(entry.data) if entry.size is None else entry.size
        packed = len(payload) if entry.packed is None else entry.packed
        offset = len(body) if entry.offset is None else entry.offset
        if entry.write_local:
            name = entry.name if entry.local_name is None else entry.local_name
            flags = entry.flags if entry.local_flags is None else entry.local_flags
            body += struct.pack(
                "<4s2B4HL2L2H", entry.local_magic, entry.version, 0, flags, entry.method, 0, 0x21,
                crc, narrow(packed), narrow(size), len(name), len(entry.local_extra),
            ) + name + entry.local_extra + payload
        directory += struct.pack(
            "<4s4B4HL2L5H2L", b"PK\x01\x02", 20, entry.system, entry.version, 0, entry.flags, entry.method,
            0, 0x21, crc, narrow(packed), narrow(size), len(entry.name), len(entry.extra), len(entry.comment),
            0, 0, entry.external, narrow(offset),
        ) + entry.name + entry.extra + entry.comment
    body += between
    total = len(entries) if count is None else count
    end = struct.pack(
        "<4s4H2LH", b"PK\x05\x06", disk, directory_disk, total if count_here is None else count_here, total,
        len(directory) if directory_size is None else directory_size,
        len(body) if directory_offset is None else directory_offset,
        len(comment) if declared_comment is None else declared_comment,
    )
    return prefix + bytes(body) + bytes(directory) + end + comment + trailer


def written(members: dict[str, bytes], method: int = zipfile.ZIP_DEFLATED) -> bytes:
    """An archive produced by the standard library writer with fixed metadata."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", method) as bundle:
        for name, content in members.items():
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = method
            info.create_system = 3
            info.external_attr = REGULAR
            bundle.writestr(info, content)
    return buffer.getvalue()


def read_members(payload: bytes) -> list[list[Any]]:
    return [[name, blob(content)] for name, content in personal._zip_files(payload).items()]


def zip_case(name: str, payload: bytes, **limits: int) -> dict[str, Any]:
    with bounds(**limits) as active, warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return {"name": name, "limits": active, "zip": payload.hex(), **attempt(read_members, payload)}


def zip64_record(count: int, size: int, offset: int) -> bytes:
    return struct.pack("<4sQ2H2L4Q", b"PK\x06\x06", 44, 45, 45, 0, 0, count, count, size, offset)


def zip64_locator(offset: int, disks: int = 1, disk: int = 0) -> bytes:
    return struct.pack("<4sLQL", b"PK\x06\x07", disk, offset, disks)


def hidden_zip64(adversarial: bool, disks: int = 1, signature: bytes = b"PK\x06\x06") -> bytes:
    """An archive whose last directory entry hides ZIP64 records in its comment.

    The end record describes one entry. The ZIP64 record that ``zipfile`` reads
    instead can describe a different directory (``adversarial``).
    """
    first = Entry(b"followers_1.json", roster("nova_labs"))
    second = Entry(b"following.json", roster("pixel_forge", following=True))
    probe = build([first, second])
    split = probe.index(b"PK\x01\x02")
    locals_part = probe[:split]
    second_offset = probe.index(b"PK\x03\x04", 4)
    directory_first = struct.pack(
        "<4s4B4HL2L5H2L", b"PK\x01\x02", 20, 3, 20, 0, 0, 0, 0, 0x21, zlib.crc32(first.data),
        len(first.data), len(first.data), len(first.name), 0, 76, 0, 0, REGULAR, 0,
    ) + first.name
    directory_second = struct.pack(
        "<4s4B4HL2L5H2L", b"PK\x01\x02", 20, 3, 20, 0, 0, 0, 0, 0x21, zlib.crc32(second.data),
        len(second.data), len(second.data), len(second.name), 0, 0, 0, 0, REGULAR, second_offset,
    ) + second.name
    alternate = directory_second if adversarial else b""
    real_start = len(locals_part) + len(alternate)
    record = zip64_record(2 if adversarial else 1, len(alternate) + len(directory_first), len(locals_part))
    record = signature + record[4:]
    hidden = record + zip64_locator(real_start + len(directory_first), disks)
    end = struct.pack("<4s4H2LH", b"PK\x05\x06", 0, 0, 1, 1, len(directory_first) + 76, real_start, 0)
    return locals_part + alternate + directory_first + hidden + end


UNREADABLE = "The export ZIP could not be read safely."
SMALL = b'[{"string_list_data":[{"value":"nova_labs"}]}]'


def end_only_block() -> Bits:
    """A final dynamic block whose only literal and length code is the end of the block, one bit wide."""
    return Bits().dynamic(True, 257, 1, {18: 1, 0: 2, 1: 2}).lengths((18, 127), (18, 107), 1, 0)


def space_block(distance_width: int) -> Bits:
    """A final dynamic block with codes for a space (0), the end of the block (10), and a length of three (11).

    The only distance symbol is one bit wide, or has no code at all.
    """
    widths = {18: 1, 1: 2, 2: 2} if distance_width else {18: 1, 1: 2, 2: 3, 0: 3}
    return Bits().dynamic(True, 258, 1, widths).lengths((18, 21), 1, (18, 127), (18, 74), 2, 2, distance_width)


def inflate_cases() -> list[dict[str, Any]]:
    """Members whose DEFLATE data breaks, or nearly breaks, one zlib rule while size and checksum stay honest.

    ``zipfile`` hands zlib every compressed byte it has read and lets it decode up
    to the read size, not up to the declared size, so a broken block after the
    content is still an error. Where the input or the output limit ends first,
    zlib never sees the broken part and the member is accepted.
    """
    name = b"followers_1.json"
    spaces = b" " * 4000
    empty_block = b"\x00\x00\x00\xff\xff"
    open_block = b"\x00" + deflate_stored_block(SMALL)[1:]

    def member(stream: bytes | Bits, content: bytes = SMALL) -> bytes:
        payload = stream.done() if isinstance(stream, Bits) else stream
        return build([Entry(name, content, method=8, payload=payload)])

    def after(tail: bytes | Bits) -> bytes:
        """The whole content in a stored block that is not final, then more DEFLATE data."""
        return member(open_block + (tail.done() if isinstance(tail, Bits) else tail))

    def filled(count: int) -> Bits:
        """A fixed Huffman block that is not final and starts with that many spaces, mostly as long matches."""
        bits = Bits().block(False, 1).text(b" ")
        for _ in range((count - 1) // 258):
            bits.fixed(285).distance(1)
        return bits.text(b" " * ((count - 1) % 258))

    specs: list[tuple[str, bytes, bool, dict[str, int]]] = [
        ("stored block with a wrong length complement", member(b"\x01" + struct.pack("<HH", len(SMALL), 0) + SMALL), False, {}),
        ("fixed huffman stream ending in an invalid distance code", member(deflate_fixed(SMALL)[:-1] + b"\xff"), False, {}),
        ("invalid block type after the content", after(Bits().block(True, 3)), False, {}),
        ("dynamic block with 287 literal and length symbols", after(Bits().block(True, 2).field(30, 5).field(0, 5).field(0, 4)), False, {}),
        ("dynamic block with 31 distance symbols", after(Bits().block(True, 2).field(0, 5).field(30, 5).field(0, 4)), False, {}),
        ("dynamic block with an incomplete code length code", after(Bits().dynamic(True, 257, 1, {16: 1})), False, {}),
        ("dynamic block with an over-subscribed code length code", after(Bits().dynamic(True, 257, 1, {16: 1, 17: 1, 18: 1})), False, {}),
        ("length repeat with nothing to repeat", after(Bits().dynamic(True, 257, 1, {16: 1, 0: 1}).lengths((16, 0))), False, {}),
        ("length repeat cut before its count field", after(Bits().dynamic(True, 257, 1, {16: 1, 0: 1}, count=10).lengths(16)), True, {}),
        ("length repeat with its count field and nothing to repeat", after(Bits().dynamic(True, 257, 1, {16: 1, 0: 1}, count=10).lengths((16, 0))), False, {}),
        ("length repeat past the symbol count", after(Bits().dynamic(True, 257, 1, {18: 1, 0: 1}).lengths((18, 127), (18, 127))), False, {}),
        ("dynamic block without an end-of-block code", after(Bits().dynamic(True, 257, 1, {18: 1, 0: 1}).lengths((18, 127), (18, 109))), False, {}),
        ("empty code length code reads one bit per symbol", after(Bits().dynamic(True, 257, 1, {}).field(0, 258)), False, {}),
        ("empty code length code cut before its last symbols", after(Bits().dynamic(True, 257, 1, {}).field(0, 258).done()[:-1]), True, {}),
        ("incomplete literal and length code", after(Bits().dynamic(True, 257, 1, {18: 1, 0: 2, 2: 2}).lengths((18, 127), (18, 107), 2, 0)), False, {}),
        ("over-subscribed literal and length code", after(Bits().dynamic(True, 257, 1, {18: 1, 0: 2, 1: 2}).lengths(1, 1, (18, 127), (18, 105), 1, 0)), False, {}),
        ("literal and length code holding only the end of the block", after(end_only_block().code(0, 1)), True, {}),
        ("unused code of a one code literal and length set", after(end_only_block().code(1, 1)), False, {}),
        ("incomplete distance code", after(Bits().dynamic(True, 257, 2, {18: 1, 1: 2, 2: 2}).lengths((18, 127), (18, 107), 1, 2, 2)), False, {}),
        ("one distance code used by a match", member(space_block(1).code(0, 1).code(3, 2).code(0, 1).code(2, 2), b"    "), True, {}),
        ("unused code of a one code distance set", member(space_block(1).code(0, 1).code(3, 2).code(1, 1).code(2, 2), b"    "), False, {}),
        ("literals without any distance code", member(space_block(0).code(0, 1).code(0, 1).code(0, 1).code(0, 1).code(2, 2), b"    "), True, {}),
        ("match without any distance code", member(space_block(0).code(0, 1).code(3, 2).code(0, 1).code(2, 2), b"    "), False, {}),
        ("fixed huffman literal and length symbol 286", after(Bits().block(True, 1).fixed(286)), False, {}),
        ("fixed huffman distance symbol 30", after(Bits().block(True, 1).fixed(257).code(30, 5)), False, {}),
        ("distance before the first byte of output", member(Bits().block(True, 1).fixed(257).distance(1).fixed(256), b""), False, {}),
        ("distance one byte before the content", member(Bits().block(True, 1).text(SMALL).fixed(257).distance(len(SMALL) + 1).fixed(256)), False, {}),
        ("distance reaching the first byte of the content", member(Bits().block(True, 1).text(SMALL).fixed(257).distance(len(SMALL)).fixed(256)), True, {}),
        ("input ends inside a dynamic block header", after(Bits().block(False, 2)), True, {}),
        ("input ends inside a fixed huffman code", after(Bits().block(False, 1)), True, {}),
        ("input ends after a block that is not final", after(Bits().block(False, 1).fixed(256)), True, {}),
    ]
    small = {"maxFileBytes": 4095}
    specs += [
        ("literal past the output limit hides a corrupt block", member(filled(4097).fixed(256).block(True, 3), spaces), True, small),
        ("corrupt block right at the output limit", member(filled(4096).fixed(256).block(True, 3), spaces), False, small),
        ("far distance at the output limit is not examined", member(filled(4096).fixed(257).distance(5000).fixed(256), spaces), True, small),
        ("far distance one byte before the output limit", member(filled(4095).fixed(257).distance(5000).fixed(256), spaces), False, small),
        ("match cut by the output limit hides a corrupt block", member(filled(4090).fixed(285).distance(1).fixed(256).block(True, 3), spaces), True, small),
        ("stored block cut by the output limit hides a corrupt block", member(b"\x00" + deflate_stored_block(b" " * 5000)[1:] + b"\x07", spaces), True, small),
        ("content complete within the first read hides a corrupt block in the next read", member(Bits().block(False, 1).text(b" " * 4096).fixed(256).block(True, 3), spaces), True, small),
        ("compressed data longer than one read", member(empty_block * 1000 + deflate_stored_block(SMALL)), True, small),
        ("corrupt block in the second read", member(empty_block * 1000 + open_block + b"\x07"), False, small),
        ("empty member never reads past its first chunk", member(empty_block * 1000 + b"\x07", b""), True, small),
        ("stored block a few bytes longer than one read", member(deflate_stored_block(b" " * 4095), b" " * 4095), True, small),
    ]
    cases = []
    for label, payload, accepted, limits in specs:
        item = zip_case(label, payload, **limits)
        if ("ok" in item) != accepted or item.get("error", UNREADABLE) != UNREADABLE:
            raise SystemExit(f"unexpected Python result for: {label}")
        cases.append(item)
    return cases


def mutation_sweep(name: str, content: bytes, stream: bytes) -> dict[str, Any]:
    """Every single-byte change inside one member's DEFLATE data, size and checksum left honest.

    Python rejects almost every change with the same sentence. The exceptions are
    recorded as ``offset * 256 + value``: ``accepted`` when the member still reads
    as the unchanged content, ``other`` with the sentence when it differs.
    """
    payload = build([Entry(b"followers_1.json", content, method=8, payload=stream)])
    start = payload.index(stream)
    expected = personal._zip_files(payload)
    accepted: list[int] = []
    other: list[list[Any]] = []
    changed = bytearray(payload)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for offset in range(len(stream)):
            original = changed[start + offset]
            for value in range(256):
                if value == original:
                    continue
                changed[start + offset] = value
                try:
                    result = personal._zip_files(bytes(changed))
                except ValueError as error:
                    if str(error) != UNREADABLE:
                        other.append([offset * 256 + value, str(error)])
                    continue
                if result != expected:
                    raise SystemExit(f"a changed stream produced other content: {name} at {offset}")
                accepted.append(offset * 256 + value)
            changed[start + offset] = original
    return {
        "name": name, "limits": {key: getattr(personal, constant) for key, constant in LIMIT_NAMES.items()},
        "zip": payload.hex(), "start": start, "length": len(stream), "rejected": UNREADABLE,
        "accepted": accepted, "other": other,
    }


def mutation_sweeps() -> list[dict[str, Any]]:
    longer = roster("nova_labs", "pixel_forge", "lunar_arch", "ember_lab")
    flushed = zlib.compressobj(9, zlib.DEFLATED, -15)
    parts = flushed.compress(longer) + flushed.flush(zlib.Z_SYNC_FLUSH) + flushed.compress(SMALL) + flushed.flush()
    return [
        mutation_sweep("stored block", SMALL, deflate_stored_block(SMALL)),
        mutation_sweep("fixed huffman block", SMALL, deflate_fixed(SMALL)),
        mutation_sweep("hand made dynamic block", b"    ", space_block(1).code(0, 1).code(3, 2).code(0, 1).code(2, 2).done()),
        mutation_sweep("stream written by zlib in two flushed parts", longer + SMALL, parts),
    ]


def archive_cases() -> dict[str, Any]:
    followers = roster("nova_labs")
    following = roster("nova_labs", "pixel_forge", following=True)
    root = "export/connections/followers_and_following/"
    good = Entry(b"followers_1.json", followers)
    symlink = 0o120777 << 16
    corrupt = bytearray(written({"followers_1.json": b"[]"}))
    name_size, extra_size = struct.unpack_from("<HH", corrupt, 26)
    corrupt[30 + name_size + extra_size] = 0x07
    sync = zlib.compressobj(9, zlib.DEFLATED, -15)
    unfinished = sync.compress(followers) + sync.flush(zlib.Z_SYNC_FLUSH)
    unicode_path = struct.pack("<HHBL", 0x7075, 5 + 16, 1, zlib.crc32(b"x.bin")) + b"followers_1.json"
    zip64_extra = struct.pack("<HHQQQ", 1, 24, len(followers), len(followers), 0)
    plain = build([good])
    cases = [
        zip_case("stored members at the root", build([good, Entry(b"following.json", following)])),
        zip_case("archive written by zipfile with deflate", written({
            root + "followers_1.json": followers, root + "followers_2.json": roster("pixel_forge", "nova_labs"),
            root + "following.json": following, "messages/inbox.json": b"not valid JSON, never read",
        })),
        zip_case("larger deflated member", written({"followers_1.json": roster(*(["nova_labs", "pixel_forge", "lunar_arch", "ember_lab", "sunset_field", "atlas_studio"] * 50))})),
        zip_case("archive written by zipfile without compression", written({"following.json": following}, zipfile.ZIP_STORED)),
        zip_case("hand made stored block deflate", build([Entry(b"followers_1.json", followers, method=8, payload=deflate_stored_block(followers))])),
        zip_case("hand made fixed huffman deflate", build([Entry(b"followers_1.json", followers, method=8, payload=deflate_fixed(followers))])),
        zip_case("fixed huffman deflate with high bytes", build([Entry(b"followers_1.json", b'["\xc3\xa9\xf0\x9f\x98\x80"]', method=8, payload=deflate_fixed(b'["\xc3\xa9\xf0\x9f\x98\x80"]'))])),
        zip_case("unrelated member with invalid deflate data is never read", build([Entry(b"media/photo.bin", b"x" * 50, method=8, payload=b"\x07garbage", crc=1), good])),
        zip_case("unrelated encrypted member is ignored", build([Entry(b"secret.json", b"x", flags=1), good])),
        zip_case("unrelated member with unsupported compression is ignored", build([Entry(b"media/clip.bin", b"x", method=99), good])),
        zip_case("directory entries are skipped", build([Entry(b"connections/", external=(0o040755 << 16) | 0x10), Entry(b"connections/followers_and_following/", external=0o040755 << 16), Entry(b"connections/followers_and_following/followers_1.json", followers)])),
        zip_case("directory named like a recognized file", build([Entry(b"followers_1.json/", external=0o040755 << 16)])),
        zip_case("member without a unix mode", build([Entry(b"followers_1.json", followers, external=0, system=0)])),
        zip_case("empty archive", build([])),
        zip_case("archive comment", build([good], comment=b"exported for parity")),
        zip_case("data before the archive", build([good], prefix=b"#!launcher stub\n")),
        zip_case("corrupt deflate stream", bytes(corrupt)),
        zip_case("truncated archive", plain[:-10]),
        zip_case("not an archive", b"not a zip"),
        zip_case("empty input", b""),
        zip_case("end record alone declares 2000 entries", struct.pack("<4s4H2LH", b"PK\x05\x06", 0, 0, 2000, 2000, 0, 0, 0)),
        zip_case("end record declares 65535 entries", build([good], count=0xFFFF)),
        zip_case("three entries with a limit of two", build([Entry(b"one.txt"), Entry(b"two.txt"), Entry(b"followers_1.json", b"[]")]), maxFiles=2),
        zip_case("zip64 marker in the directory offset", build([good], directory_offset=0xFFFFFFFF)),
        zip_case("zip64 marker in the directory size", build([good], directory_size=0xFFFFFFFF)),
        zip_case("trailing bytes after the end record", build([good], trailer=b"extra")),
        zip_case("declared comment longer than the file", build([good], declared_comment=4)),
        zip_case("multi disk number", build([good], disk=1)),
        zip_case("directory on another disk", build([good], directory_disk=1)),
        zip_case("entry counts disagree", build([good], count_here=2)),
        zip_case("comment contains an end signature", build([good], comment=b"PK\x05\x06 and more text here")),
        zip_case("directory size larger than the archive", build([good], directory_size=100000)),
        zip_case("directory size too small", build([good], directory_size=20)),
        zip_case("directory size reaches into member data", build([good], directory_size=len(plain) - 22 - 5)),
        zip_case("end record counts two entries for one", build([good], count=2)),
        zip_case("end record counts zero entries for one", build([good], count=0)),
        zip_case("member name of 1025 bytes", build([Entry(b"a" * 1025)])),
        zip_case("symbolic link member", build([Entry(b"followers_1.json", b"somewhere.json", external=symlink)])),
        zip_case("unrelated symbolic link member", build([good, Entry(b"link", b"target", external=symlink)])),
        zip_case("fifo member", build([Entry(b"pipe", external=0o010644 << 16), good])),
        zip_case("device member", build([Entry(b"device", external=0o060644 << 16), good])),
        zip_case("encrypted recognized member", build([Entry(b"followers_1.json", followers, flags=1)])),
        zip_case("bzip2 recognized member", build([Entry(b"followers_1.json", followers, method=12)])),
        zip_case("unknown compression on a recognized member", build([Entry(b"following.json", following, method=99)])),
        zip_case("duplicate unrelated names", build([Entry(b"notes.txt", b"a"), Entry(b"notes.txt", b"b"), good])),
        zip_case("duplicate recognized names", build([good, Entry(b"followers_1.json", roster("pixel_forge"))])),
        zip_case("parent traversal in an unrelated member", build([good, Entry(b"../outside.txt", b"x")])),
        zip_case("drive letter in an unrelated member", build([good, Entry(b"C:/outside.txt", b"x")])),
        zip_case("backslash in an unrelated member", build([good, Entry(b"a\\b.txt", b"x")])),
        zip_case("absolute unrelated member", build([good, Entry(b"/abs.txt", b"x")])),
        zip_case("protected unrelated member", build([good, Entry(b".env", b"x")])),
        zip_case("protected directory member", build([good, Entry(b".ssh/", external=0o040700 << 16)])),
        zip_case("empty member name", build([good, Entry(b"", b"x")])),
        zip_case("unsafe path is reported before a duplicate", build([Entry(b"../x", b"a"), Entry(b"../x", b"b")])),
        zip_case("declared size larger than the content", build([Entry(b"followers_1.json", followers, size=len(followers) + 5)])),
        zip_case("declared size smaller than the content", build([Entry(b"followers_1.json", followers, size=2)])),
        zip_case("declared size and checksum describe a prefix", build([Entry(b"followers_1.json", followers, size=2, crc=zlib.crc32(followers[:2]))])),
        zip_case("deflated prefix with a matching checksum", build([Entry(b"followers_1.json", followers, method=8, size=2, crc=zlib.crc32(followers[:2]))])),
        zip_case("deflated member declared larger than the content", build([Entry(b"followers_1.json", followers, method=8, size=len(followers) + 1)])),
        zip_case("wrong checksum", build([Entry(b"followers_1.json", followers, crc=12345)])),
        zip_case("wrong checksum on a deflated member", build([Entry(b"followers_1.json", followers, method=8, crc=12345)])),
        zip_case("deflated member with no data", build([Entry(b"followers_1.json", b"", method=8, payload=b"")])),
        zip_case("stored empty member", build([Entry(b"followers_1.json", b"")])),
        zip_case("deflate stream followed by padding", build([Entry(b"followers_1.json", followers, method=8, payload=deflate(followers) + b"\x00" * 9)])),
        zip_case("deflate stream without a final block", build([Entry(b"followers_1.json", followers, method=8, payload=unfinished)])),
        zip_case("deflate stream cut short", build([Entry(b"followers_1.json", followers, method=8, payload=deflate(followers)[:-6])])),
        zip_case("member above the file limit", build([Entry(b"followers_1.json", b" " * 65)]), maxFileBytes=64),
        zip_case("unrelated member above the file limit", build([Entry(b"big.bin", b" " * 65), Entry(b"followers_1.json", b"[]")]), maxFileBytes=64),
        zip_case("members above the input limit together", build([Entry(b"followers_1.json", b" " * 40), Entry(b"following.json", b" " * 40)]), maxFileBytes=64, maxInputBytes=79),
        zip_case("local name differs from the directory", build([Entry(b"followers_1.json", followers, local_name=b"followers_2.json")])),
        zip_case("local header has the wrong signature", build([Entry(b"followers_1.json", followers, local_magic=b"PK\x07\x08")])),
        zip_case("local header offset beyond the file", build([Entry(b"followers_1.json", followers, offset=100000)])),
        zip_case("directory offset pushes a header before the file", build([good], directory_offset=len(plain))),
        zip_case("needs a newer reader version", build([Entry(b"followers_1.json", followers, version=64)])),
        zip_case("unrelated member needs a newer reader version", build([Entry(b"notes.txt", b"x", version=64), good])),
        zip_case("compressed patch flag", build([Entry(b"followers_1.json", followers, flags=1 << 5)])),
        zip_case("strong encryption flag", build([Entry(b"followers_1.json", followers, flags=1 << 6)])),
        zip_case("data descriptor flag", build([Entry(b"followers_1.json", followers, flags=1 << 3)])),
        zip_case("local extra field is skipped", build([Entry(b"followers_1.json", followers, local_extra=b"\x55\x54\x05\x00\x01\x00\x00\x00\x00")])),
        zip_case("compressed size runs into the next member", build([Entry(b"followers_1.json", followers, packed=len(followers) + 40, size=len(followers) + 40), Entry(b"following.json", following)])),
        zip_case("compressed size runs into the directory", build([Entry(b"followers_1.json", followers, packed=len(followers) + 10, size=len(followers) + 10)])),
        zip_case("two directory entries share one local header", build([good, Entry(b"alias.bin", followers, offset=0, write_local=False)])),
        zip_case("null byte ends the member name", build([Entry(b"followers_1.json\x00hidden.exe", followers)])),
        zip_case("unicode path field renames a member", build([Entry(b"x.bin", followers, extra=unicode_path)])),
        zip_case("extra field longer than its block", build([Entry(b"followers_1.json", followers, extra=b"\x99\x99\x40\x00ab")])),
        zip_case("zip64 extra field carries the sizes", build([Entry(b"followers_1.json", followers, size=0xFFFFFFFF, packed=0xFFFFFFFF, offset=0xFFFFFFFF, extra=zip64_extra)])),
        zip_case("zip64 extra field is too short", build([Entry(b"followers_1.json", followers, size=0xFFFFFFFF, extra=struct.pack("<HHL", 1, 4, 7))])),
        zip_case("zip64 sizes without an extra field on an unrelated member", build([Entry(b"big.bin", b"x", size=0xFFFFFFFF), good])),
        zip_case("zip64 sizes without an extra field on a recognized member", build([Entry(b"followers_1.json", followers, size=0xFFFFFFFF)])),
        zip_case("hidden zip64 records that agree with the end record", hidden_zip64(False)),
        zip_case("hidden zip64 records that reveal another directory", hidden_zip64(True)),
        zip_case("hidden zip64 locator spanning two disks", hidden_zip64(False, disks=2)),
        zip_case("hidden zip64 locator without a zip64 record", hidden_zip64(True, signature=b"PK\x00\x00")),
        zip_case("code page 437 directory name", build([Entry(b"caf\x82/followers_and_following/followers_1.json", followers)])),
        zip_case("utf-8 directory name", build([Entry("caf\u00e9/followers_and_following/followers_1.json".encode(), followers, flags=1 << 11)])),
        zip_case("utf-8 flag only in the local header", build([Entry(b"caf\xc3\xa9/followers_and_following/followers_1.json", followers, local_flags=1 << 11)])),
    ]
    cases += inflate_cases()
    message_only = [
        zip_case("utf-8 flag with invalid name bytes", build([Entry(b"\xff\xfe/followers_1.json", followers, flags=1 << 11)])),
        zip_case("utf-8 flag with invalid bytes in the local name", build([Entry(b"caf\x82/followers_and_following/followers_1.json", followers, local_flags=1 << 11)])),
    ]
    for item in message_only:
        if "error" not in item:
            raise SystemExit(f"expected Python to reject: {item['name']}")
    inside = {root + "followers_1.json": followers, root + "followers_2.json": roster("pixel_forge", "nova_labs"), root + "following.json": following}
    parsed = [
        parse_case("zip with the standard layout", {"export.zip": written({**inside, "messages/inbox.json": b"not valid JSON, never read"})}),
        parse_case("direct files with the same content", {name.removeprefix("export/"): content for name, content in inside.items()}),
        parse_case("zip with two export roots", {"export.zip": written({"one/" + root + "followers_1.json": followers, "two/" + root + "following.json": following})}),
        parse_case("zip with nothing recognized", {"export.zip": written({"messages/inbox.json": b"[]"})}),
        parse_case("empty zip", {"export.zip": build([])}),
        parse_case("zip with overlapping shards", {"export.zip": build([Entry(b"followers.json", followers), Entry(b"followers_1.json", followers)])}),
        parse_case("zip with a malformed recognized member", {"export.zip": build([Entry(b"followers_1.json", b"not json")])}),
        parse_case("zip with an owner mismatch", {"export.zip": build([Entry(b"followers_1.json", json.dumps({"owner": "nova_labs", "relationships_followers": []}).encode())])}),
        parse_case("zip above the upload limit", {"export.zip": build([Entry(b"followers_1.json", b"[]")])}, maxInputBytes=50),
        parse_case("zip with a corrupt deflate stream", {"export.zip": bytes(corrupt)}),
        parse_case("zip inside a folder name", {"downloads/export.zip": build([good])}),
        parse_case("zip with a wrong stored block complement", {"export.zip": build([Entry(b"followers.json", SMALL, method=8, payload=b"\x01" + struct.pack("<HH", len(SMALL), 0) + SMALL)])}),
        parse_case("zip with an invalid distance code after the content", {"export.zip": build([Entry(b"followers.json", SMALL, method=8, payload=deflate_fixed(SMALL)[:-1] + b"\xff")])}),
        parse_case("zip with a hand made fixed huffman member", {"export.zip": build([Entry(b"followers.json", SMALL, method=8, payload=deflate_fixed(SMALL))])}),
    ]
    return {"cases": cases, "message_only": message_only, "mutations": mutation_sweeps(), "parsed": parsed}


# --------------------------------------------------------------------------- snapshots


def snapshot(
    followers: list[str] | None, following: list[str] | None, captured_at: str | None,
    *, followers_shards: list[int] | None = None, following_shards: list[int] | None = None,
    complete_followers: bool = False, complete_following: bool = False,
    imported_at: str = "2026-09-30T11:00:00+00:00", account: str = ACCOUNT,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "followers": followers, "following": following, "captured_at": captured_at, "imported_at": imported_at,
        "shards": {
            "followers": ([1] if followers is not None else []) if followers_shards is None else followers_shards,
            "following": ([0] if following is not None else []) if following_shards is None else following_shards,
        },
        "declarations": {"followers": complete_followers, "following": complete_following},
    }
    item["content_id"] = personal._content_id(item, account)
    item["id"] = personal._digest([item["content_id"], captured_at])
    return item


def view_case(name: str, item: dict[str, Any], now: datetime = CLOCK) -> dict[str, Any]:
    FixedClock.fixed = now
    try:
        view = personal._view({"schema_version": 1, "account": ACCOUNT, "current": item["id"], "snapshots": [item]})
    finally:
        FixedClock.fixed = CLOCK
    return {
        "name": name, "account": ACCOUNT, "now": stamp(now), "snapshot": item,
        "view": {
            "username": view["username"], "snapshot_id": view["snapshot_id"], "status": view["status"],
            "stale": view["stale"], "last_success_at": view["last_success_at"], "coverage": view["coverage"],
            "coverage_details": view["coverage_details"], "metrics": view["metrics"], "issues": view["issues"],
            "accounts": [
                {key: account[key] for key in ("username", "following", "followed_by", "relationship")}
                for account in view["accounts"]
            ],
            "capture_time_basis": view["provenance"]["capture_time_basis"],
        },
    }


def view_cases() -> list[dict[str, Any]]:
    when = "2026-09-30T06:00:00+00:00"
    followers = ["lunar_arch", "nova_labs"]
    following = ["nova_labs", "pixel_forge"]
    modes: dict[str, dict[str, Any]] = {
        "complete": {"present": True, "declared": True},
        "partial": {"present": True, "declared": False},
        "missing": {"present": False, "declared": True},
    }
    cases = [
        view_case("neither direction declared", snapshot(followers, following, when)),
        view_case("both declared and dated", snapshot(followers, following, when, complete_followers=True, complete_following=True)),
        view_case("declared but undated", snapshot(followers, following, None, complete_followers=True, complete_following=True)),
        view_case("declared with a shard gap", snapshot(followers, following, when, followers_shards=[1, 3], complete_followers=True, complete_following=True)),
        view_case("declared with a lone second shard", snapshot(followers, following, when, followers_shards=[2], complete_followers=True, complete_following=True)),
        view_case("declared with three contiguous shards", snapshot(followers, following, when, followers_shards=[1, 2, 3], complete_followers=True, complete_following=True)),
        view_case("numbered following shard", snapshot(followers, following, when, following_shards=[1], complete_followers=True, complete_following=True)),
        view_case("only following supplied with both flags", snapshot(None, following, when, complete_followers=True, complete_following=True)),
        view_case("only followers supplied with both flags", snapshot(followers, None, when, complete_followers=True, complete_following=True)),
        view_case("present empty followers complete", snapshot([], following, when, complete_followers=True, complete_following=True)),
        view_case("present empty following complete", snapshot(followers, [], when, complete_followers=True, complete_following=True)),
        view_case("both present and empty", snapshot([], [], when, complete_followers=True, complete_following=True)),
        view_case("followers complete and following partial", snapshot(followers, following, when, complete_followers=True)),
        view_case("following complete and followers partial", snapshot(followers, following, when, complete_following=True)),
        view_case("captured exactly 36 hours ago", snapshot(followers, following, "2026-09-29T00:00:00+00:00", complete_followers=True, complete_following=True)),
        view_case("captured 36 hours and one second ago", snapshot(followers, following, "2026-09-28T23:59:59+00:00", complete_followers=True, complete_following=True)),
        view_case("stale and partial stays degraded", snapshot(followers, following, "2026-09-01T12:00:00+00:00")),
        view_case("golden snapshot b", snapshot(["pixel_forge"], ["lunar_arch", "nova_labs"], "2026-09-10T12:00:00+00:00", complete_followers=True, complete_following=True)),
    ]
    for first, one in modes.items():
        for second, two in modes.items():
            cases.append(view_case(
                f"coverage label followers {first} and following {second}",
                snapshot(
                    followers if one["present"] else None, following if two["present"] else None, when,
                    complete_followers=one["declared"], complete_following=two["declared"],
                ),
            ))
    return cases


def summarize(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "current": state["current"],
        "snapshots": [
            {key: item[key] for key in ("id", "content_id", "captured_at", "declarations")}
            for item in state["snapshots"]
        ],
    }


@dataclass
class Step:
    followers: list[str] | None
    following: list[str] | None
    captured_at: str | None = None
    complete_followers: bool = False
    complete_following: bool = False
    followers_shards: list[int] | None = None
    following_shards: list[int] | None = None


def store_scenario(directory: Path, name: str, steps: list[Step], **limits: int) -> dict[str, Any]:
    workspace = directory / f"store-{len(list(directory.iterdir()))}"
    recorded = []
    with bounds(**limits):
        for index, step in enumerate(steps):
            FixedClock.fixed = CLOCK + timedelta(minutes=index)
            values = {"followers": step.followers, "following": step.following}
            shards = {
                "followers": ([1] if step.followers is not None else []) if step.followers_shards is None else step.followers_shards,
                "following": ([0] if step.following is not None else []) if step.following_shards is None else step.following_shards,
            }
            entry: dict[str, Any] = {
                "input": {
                    "followers": step.followers, "following": step.following, "shards": shards,
                    "captured_at": step.captured_at, "complete_followers": step.complete_followers,
                    "complete_following": step.complete_following,
                },
                "imported_at": stamp(FixedClock.fixed),
            }
            try:
                captured = personal._capture(step.captured_at)
                _, receipt = personal._store(
                    workspace, ACCOUNT, values, shards, captured, step.complete_followers, step.complete_following,
                )
                entry["receipt"] = receipt
            except ValueError as error:
                entry["error"] = str(error)
            state = personal._state(workspace)
            entry["state"] = summarize(state) if state is not None else None
            recorded.append(entry)
        result = {"name": name, "account": ACCOUNT, "maxSnapshots": personal.MAX_SNAPSHOTS, "steps": recorded}
    FixedClock.fixed = CLOCK
    return result


def store_cases(directory: Path) -> list[dict[str, Any]]:
    one, two, three, four = "2026-09-01T12:00:00+00:00", "2026-09-10T12:00:00+00:00", "2026-09-20T12:00:00+00:00", "2026-09-25T12:00:00+00:00"
    base = (["nova_labs"], ["nova_labs", "pixel_forge"])
    other = (["pixel_forge"], ["nova_labs", "pixel_forge"])
    third = (["lunar_arch"], ["nova_labs", "pixel_forge"])
    fourth = (["ember_lab"], ["nova_labs"])
    return [
        store_scenario(directory, "first import becomes current", [Step(*base, two)]),
        store_scenario(directory, "undated first import becomes current", [Step(*base)]),
        store_scenario(directory, "exact duplicate", [Step(*base, two), Step(*base, two)]),
        store_scenario(directory, "duplicate strengthens one declaration", [Step(*base, two), Step(*base, two, complete_followers=True), Step(*base, two, complete_following=True), Step(*base, two)]),
        store_scenario(directory, "undated duplicate strengthens a declaration", [Step(*base), Step(*base, complete_followers=True)]),
        store_scenario(directory, "two offsets for one instant are one snapshot", [Step(*base, "2026-09-10T12:00:00Z"), Step(*base, "2026-09-10T14:00:00+02:00")]),
        store_scenario(directory, "same roster at a newer capture time", [Step(*base, one), Step(*base, two)]),
        store_scenario(directory, "older dated import after a newer one", [Step(*base, two), Step(*other, one)]),
        store_scenario(directory, "undated import after a dated one", [Step(*base, two), Step(*other)]),
        store_scenario(directory, "undated import after an undated one", [Step(*base), Step(*other)]),
        store_scenario(directory, "dated import displaces an undated current", [Step(*base), Step(*other, one)]),
        store_scenario(directory, "undated snapshot gains a capture time", [Step(*base, complete_followers=True), Step(*base, two)]),
        store_scenario(directory, "enriched snapshot keeps its position and an older date stays behind", [Step(*other, three), Step(*base), Step(*third), Step(*base, one, complete_following=True)]),
        store_scenario(directory, "duplicate wins over enrichment", [Step(*base, two), Step(*base), Step(*base, two, complete_followers=True)]),
        store_scenario(directory, "same capture time with a different roster", [Step(*base, two), Step(*other, two), Step(*base, two)]),
        store_scenario(directory, "invalid capture time changes nothing", [Step(*base, two), Step(*other, "2999-01-01T00:00:00Z")]),
        store_scenario(directory, "history cap", [Step(*base, one), Step(*other, two), Step(*third, three), Step(*fourth, four), Step(*other, two, complete_followers=True), Step(*base, one)], maxSnapshots=3),
        store_scenario(directory, "enrichment at the history cap", [Step(*base), Step(*other, two), Step(*base, three)], maxSnapshots=2),
        store_scenario(directory, "one direction only", [Step(None, ["nova_labs"], one, complete_following=True), Step(["nova_labs"], None, two)]),
        store_scenario(directory, "shards are part of the content identity", [Step(*base, one), Step(*base, two, followers_shards=[1, 2])]),
    ]


def event_case(name: str, items: list[dict[str, Any]], **limits: int) -> dict[str, Any]:
    with bounds(**limits):
        events = personal._events(items)
        cap = personal.MAX_EVENTS
    return {
        "name": name, "account": ACCOUNT, "cap": cap, "snapshots": items,
        "events": [
            {key: event[key] for key in ("id", "ts", "type", "username", "previous_captured_at", "source", "evidence")}
            for event in events
        ],
    }


def event_cases() -> list[dict[str, Any]]:
    one, two, three = "2026-09-01T12:00:00+00:00", "2026-09-10T12:00:00+00:00", "2026-09-20T12:00:00+00:00"
    full = {"complete_followers": True, "complete_following": True}
    first = snapshot(["nova_labs"], ["nova_labs"], one, **full)
    second = snapshot(["pixel_forge"], ["lunar_arch", "nova_labs"], two, **full)
    between = snapshot(["ember_lab", "nova_labs"], ["nova_labs"], "2026-09-05T12:00:00+00:00")
    return [
        event_case("golden vectors a to b", [first, second]),
        event_case("single snapshot is a baseline", [first]),
        event_case("no snapshots", []),
        event_case("input order does not matter", [second, first]),
        event_case("partial to partial", [snapshot(["nova_labs"], ["nova_labs"], one), snapshot(["pixel_forge"], ["lunar_arch"], two)]),
        event_case("complete then partial reports additions only", [first, snapshot(["pixel_forge"], ["lunar_arch", "nova_labs"], two)]),
        event_case("partial then complete reports removals only", [snapshot(["nova_labs"], ["nova_labs", "sunset_field"], one), second]),
        event_case("direction missing on the later side", [first, snapshot(None, ["lunar_arch"], two, **full)]),
        event_case("direction missing on the earlier side", [snapshot(["nova_labs"], None, one, **full), second]),
        event_case("identical rosters", [first, snapshot(["nova_labs"], ["nova_labs"], two, **full)]),
        event_case("three snapshots newest pair first", [first, second, snapshot(["ember_lab", "pixel_forge"], ["nova_labs"], three, **full)]),
        event_case("older partial snapshot inserted between two complete ones", [first, second, between]),
        event_case("undated snapshots are ignored", [first, snapshot(["sunset_field"], ["sunset_field"], None, **full), second]),
        event_case("rename reads as one removal and one addition", [snapshot(["nova_labs"], ["nova_labs"], one, **full), snapshot(["sunset_field"], ["nova_labs"], two, **full)]),
        event_case("usernames are ordered within a change", [snapshot([], [], one, **full), snapshot(["pixel_forge", "atlas_studio", "nova_labs", "ember_lab"], ["sunset_field", "lunar_arch"], two, **full)]),
        event_case("event cap of two", [first, second], maxEvents=2),
        event_case("event cap spans pairs", [first, second, snapshot(["ember_lab", "pixel_forge"], ["nova_labs"], three, **full)], maxEvents=4),
        event_case("shard gap blocks removals", [first, snapshot(["pixel_forge"], ["lunar_arch", "nova_labs"], two, followers_shards=[1, 3], **full)]),
    ]


# --------------------------------------------------------------------------- canonical JSON


def canonical_cases() -> dict[str, Any]:
    values: list[tuple[str, Any]] = [
        ("content identity vector", ["atlas_studio", ["nova_labs", "pixel_forge"], ["nova_labs"], {"followers": [1, 2], "following": [0]}]),
        ("null direction", ["atlas_studio", None, ["nova_labs"], {"followers": [], "following": [0]}]),
        ("empty list", []),
        ("empty object", {}),
        ("scalars", [None, True, False, 0, -1, 9007199254740991, -9007199254740991]),
        ("nested objects sort keys", {"b": {"d": 1, "c": 2}, "a": [{"z": 1, "y": 2}]}),
        ("uppercase sorts before lowercase", {"b": 1, "B": 2, "a": 3, "A": 4, "_": 5, "0": 6}),
        ("numeric text keys sort as text", {"10": 1, "9": 2, "1": 3}),
        ("empty key", {"": 1, " ": 2}),
        ("quotes and backslash", 'say "hi" \\ there'),
        ("control characters", "\b\f\n\r\t\u0000\u001f"),
        ("delete character", "\u007f"),
        ("accented text", "caf\u00e9 na\u00efve"),
        ("astral character", "\U0001f600"),
        ("line separators", "\u2028\u2029"),
        ("keys sort by code point not utf-16", {"\uff5e": 1, "\U0001f600": 2, "\ud7ff": 3, "\ue000": 4}),
        ("snapshot identity vector", ["ab8673791dca32fe54cc6ea9fcd2e422af631ed4b70d3473c4f80d9a95edeb87", "2026-09-01T12:00:00+00:00"]),
        ("undated snapshot identity", ["ab8673791dca32fe54cc6ea9fcd2e422af631ed4b70d3473c4f80d9a95edeb87", None]),
    ]
    sorts: list[tuple[str, list[str]]] = [
        ("handles", ["pixel_forge", "atlas_studio", "nova_labs", "Nova", "_x", "0x", "a.b", "a_b", "ab"]),
        ("astral against high basic plane", ["\uff5e", "\U0001f600", "\ud7ff", "\ue000", "a", "\U00010000"]),
        ("prefixes", ["ab", "a", "abc", "", "b"]),
    ]
    return {
        "cases": [
            {"name": name, "value": value, "canonical": personal._canonical(value).decode("ascii"), "digest": personal._digest(value)}
            for name, value in values
        ],
        "sorts": [{"name": name, "value": value, "sorted": sorted(value)} for name, value in sorts],
    }


# --------------------------------------------------------------------------- following state machine


def reconcile_cases() -> list[dict[str, Any]]:
    cases = []
    for confirmed in (True, False):
        for pending in (None, True, False):
            for observed in (True, False):
                decision = reconcile(EdgeState(confirmed, pending), observed)
                cases.append({
                    "confirmed_present": confirmed, "pending_present": pending, "observed_present": observed,
                    "kind": decision.kind, "present": decision.present, "event_type": decision.event_type,
                })
    return cases


def collection(spec: dict[str, Any]) -> Collection:
    return Collection(
        target=spec["target"], reported_count=spec["reported_count"],
        accounts=tuple(Account(profile_id, username) for profile_id, username in spec["accounts"]),
        complete=spec["complete"], collected_at=datetime.fromisoformat(spec["collected_at"]),
    )


def observed(target: str, accounts: dict[Any, str], minute: int = 0, **overrides: Any) -> dict[str, Any]:
    return {
        "target": target, "reported_count": len(accounts), "complete": True,
        "collected_at": stamp(datetime(2026, 9, 11, 12, minute, tzinfo=UTC)),
        "accounts": [[profile_id, username] for profile_id, username in accounts.items()],
        **overrides,
    }


def validation_cases() -> list[dict[str, Any]]:
    people = {"100": "pixel_forge", "200": "nova_labs"}
    specs: list[tuple[str, dict[str, Any]]] = [
        ("exact count", observed(ACCOUNT, people)),
        ("exact empty list", observed(ACCOUNT, {})),
        ("not complete", observed(ACCOUNT, people, complete=False)),
        ("truthy but not true", observed(ACCOUNT, people, complete=1)),
        ("negative reported count", observed(ACCOUNT, people, reported_count=-1)),
        ("text reported count", observed(ACCOUNT, people, reported_count="2")),
        ("fractional reported count", observed(ACCOUNT, people, reported_count=2.5)),
        ("boolean reported count", observed(ACCOUNT, {"100": "pixel_forge"}, reported_count=True)),
        ("null reported count", observed(ACCOUNT, people, reported_count=None)),
        ("empty profile id", observed(ACCOUNT, {"": "pixel_forge", "200": "nova_labs"})),
        ("numeric profile id", observed(ACCOUNT, {100: "pixel_forge", "200": "nova_labs"})),
        ("duplicate profile ids", {**observed(ACCOUNT, people), "accounts": [["100", "pixel_forge"], ["100", "nova_labs"]]}),
        ("reported two and collected none", observed(ACCOUNT, {}, reported_count=2)),
        ("reported zero and collected one", observed(ACCOUNT, {"100": "pixel_forge"}, reported_count=0)),
        ("reported three and collected two", observed(ACCOUNT, people, reported_count=3)),
        ("reported one and collected two", observed(ACCOUNT, people, reported_count=1)),
    ]
    cases = []
    for name, spec in specs:
        result = attempt(validate_collection, collection(spec))
        cases.append({"name": name, "collection": spec, **({"ok": True} if "ok" in result else result)})
    return cases


def dump_graph(path: Path, store: GraphStore, targets: list[str]) -> dict[str, Any]:
    with sqlite3.connect(path) as connection:
        runs = connection.execute(
            "SELECT id, target, state, run_kind, collected_at, reported_count, collected_count FROM runs ORDER BY id"
        ).fetchall()
    connection.close()
    keys = ("id", "target", "state", "run_kind", "collected_at", "reported_count", "collected_count")
    result: dict[str, Any] = {"runs": [dict(zip(keys, run, strict=True)) for run in runs], "targets": {}}
    for target in targets:
        status = store.status(target)
        result["targets"][target] = {
            "initialized": status["initialized"], "confirmed_count": status["confirmed_count"],
            "pending_count": status["pending_count"], "roster": store.roster(target),
            "events": [vars(event) for event in store.events(target)],
        }
    return result


def apply_scenario(directory: Path, name: str, steps: list[tuple[dict[str, Any], bool]]) -> dict[str, Any]:
    path = directory / f"graph-{len(list(directory.iterdir()))}" / "orbitdiff.sqlite3"
    store = GraphStore(path)
    store.initialize()
    targets: list[str] = []
    recorded = []
    for spec, baseline in steps:
        if spec["target"] not in targets:
            targets.append(spec["target"])
        result = attempt(store.apply_collection, collection(spec), baseline_run=baseline)
        if "ok" in result:
            result = {"ok": [vars(event) for event in result["ok"]]}
        recorded.append({"collection": spec, "baseline_run": baseline, **result, "state": dump_graph(path, store, targets)})
    return {"name": name, "steps": recorded}


def fixture_replay(directory: Path) -> dict[str, Any]:
    """Replay the bundled demo fixtures through the real fixture provider."""
    path = directory / "replay" / "orbitdiff.sqlite3"
    store = GraphStore(path)
    store.initialize()
    recorded = []
    for index, name in enumerate(("baseline", "pending", "confirmed")):
        FixedClock.fixed = datetime(2026, 9, 11, 12, index, tzinfo=UTC)
        provided = fixture_module.FixtureProvider(ROOT / "src" / "orbitdiff" / "fixtures" / f"{name}.json").collect(ACCOUNT)
        events = store.apply_collection(provided, baseline_run=name == "baseline")
        recorded.append({
            "fixture": f"{name}.json", "baseline_run": name == "baseline",
            "collected_at": provided.collected_at.isoformat(),
            "ok": [vars(event) for event in events], "state": dump_graph(path, store, [ACCOUNT]),
        })
    FixedClock.fixed = CLOCK
    return {"name": "bundled demo fixtures", "target": ACCOUNT, "steps": recorded}


def apply_cases(directory: Path) -> list[dict[str, Any]]:
    start = {"100": "pixel_forge", "200": "nova_labs"}
    moved = {"100": "pixel_forge", "300": "ember_lab"}
    return [
        apply_scenario(directory, "baseline is silent", [(observed(ACCOUNT, start), True)]),
        apply_scenario(directory, "empty baseline is a known zero", [(observed(ACCOUNT, {}), True)]),
        apply_scenario(directory, "first observation without the baseline flag", [(observed(ACCOUNT, start), False), (observed(ACCOUNT, start, 1), False)]),
        apply_scenario(directory, "pending then confirmed", [(observed(ACCOUNT, start), True), (observed(ACCOUNT, moved, 1), False), (observed(ACCOUNT, moved, 2), False)]),
        apply_scenario(directory, "contradiction clears pending", [(observed(ACCOUNT, start), True), (observed(ACCOUNT, moved, 1), False), (observed(ACCOUNT, start, 2), False), (observed(ACCOUNT, start, 3), False)]),
        apply_scenario(directory, "follow unfollow follow cycle", [
            (observed(ACCOUNT, {"1": "pixel_forge"}), False), (observed(ACCOUNT, {"2": "nova_labs"}, 1), False),
            (observed(ACCOUNT, {"2": "nova_labs"}, 2), False), (observed(ACCOUNT, {"1": "pixel_forge"}, 3), False),
            (observed(ACCOUNT, {"1": "pixel_forge"}, 4), False),
        ]),
        apply_scenario(directory, "rename keeps identity", [
            (observed(ACCOUNT, start), True), (observed(ACCOUNT, {"100": "pixel_forge", "200": "sunset_field"}, 1), False),
            (observed(ACCOUNT, {"100": "pixel_forge"}, 2), False), (observed(ACCOUNT, {"100": "pixel_forge"}, 3), False),
        ]),
        apply_scenario(directory, "removal seen twice is confirmed", [
            (observed(ACCOUNT, start), True), (observed(ACCOUNT, {"200": "nova_labs"}, 1), False),
            (observed(ACCOUNT, {"200": "nova_labs"}, 2), False),
        ]),
        apply_scenario(directory, "baseline run on an initialized target is a no-op", [
            (observed(ACCOUNT, start), True), (observed(ACCOUNT, {}, 1), False), (observed(ACCOUNT, {}, 2), True),
            (observed(ACCOUNT, {}, 3), False),
        ]),
        apply_scenario(directory, "invalid collections leave the state alone", [
            (observed(ACCOUNT, start), True),
            (observed(ACCOUNT, moved, 1, complete=False), False),
            (observed(ACCOUNT, moved, 1, complete=1), False),
            (observed(ACCOUNT, moved, 1, reported_count=3), False),
            (observed(ACCOUNT, {}, 1, reported_count=2), False),
            ({**observed(ACCOUNT, moved, 1), "accounts": [["100", "pixel_forge"], ["100", "ember_lab"]]}, False),
            (observed(ACCOUNT, {"": "ember_lab", "100": "pixel_forge"}, 1), False),
            (observed(ACCOUNT, moved, 1), False),
        ]),
        apply_scenario(directory, "two targets share accounts", [
            (observed(ACCOUNT, start), True), (observed("lunar_arch", {"200": "nova_labs"}), True),
            (observed("lunar_arch", {"200": "sunset_field", "100": "pixel_forge"}, 1), False),
            (observed(ACCOUNT, {"100": "pixel_forge"}, 2), False),
            (observed(ACCOUNT, {"100": "pixel_forge"}, 3), False),
            (observed("lunar_arch", {"200": "sunset_field", "100": "pixel_forge"}, 4), False),
        ]),
        apply_scenario(directory, "actors are visited in text order", [
            (observed(ACCOUNT, {"9": "pixel_forge", "10": "nova_labs"}), True), (observed(ACCOUNT, {"2": "ember_lab"}, 1), False),
            (observed(ACCOUNT, {"2": "ember_lab"}, 2), False),
        ]),
    ]


# --------------------------------------------------------------------------- output


def generate() -> dict[str, Any]:
    personal.datetime = FixedClock  # type: ignore[attr-defined]
    fixture_module.datetime = FixedClock  # type: ignore[attr-defined]
    with tempfile.TemporaryDirectory(prefix="orbitdiff-parity-") as scratch:
        directory = Path(scratch).resolve()
        return {
            "meta": {
                "generator": "web/scripts/parity_golden.py",
                "python": f"{sys.version_info.major}.{sys.version_info.minor}",
                "clock": stamp(CLOCK),
                "default_limits": {key: getattr(personal, constant) for key, constant in LIMIT_NAMES.items()},
                "messages": {
                    "python_only": "Python accepts these inputs. The hosted port rejects them on purpose.",
                    "message_only": "Both sides reject these inputs. Only the wording differs.",
                },
            },
            "handles": handle_cases(),
            "capture": capture_cases(),
            "members": member_cases(),
            "layout": layout_cases(),
            "shapes": shape_cases(),
            "hrefs": href_cases(),
            "href_message_only": message_only_rows(),
            "json": json_cases(),
            "archives": archive_cases(),
            "codepage": {"cp437": bytes(range(256)).decode("cp437")},
            "views": view_cases(),
            "store": store_cases(directory),
            "events": event_cases(),
            "canonical": canonical_cases(),
            "reconcile": reconcile_cases(),
            "collections": validation_cases(),
            "apply": apply_cases(directory),
            "replay": fixture_replay(directory),
        }


def main(arguments: list[str]) -> int:
    if len(arguments) != 2:
        print("usage: parity_golden.py OUTPUT", file=sys.stderr)
        return 2
    if sys.version_info[:2] != (3, 13):
        print("parity vectors are pinned to CPython 3.13", file=sys.stderr)
        return 2
    golden = generate()
    text = json.dumps(golden, indent=1, ensure_ascii=True, allow_nan=False) + "\n"
    Path(arguments[1]).write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
