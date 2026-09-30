from __future__ import annotations

import inspect
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

from orbitdiff.models import Account, Collection
from orbitdiff.providers import instaloader as live_provider
from orbitdiff.providers.base import (
    CollectionIncompleteError,
    InvalidTargetError,
    PrivateTargetError,
    ProviderError,
    SessionUnavailableError,
    normalize_target,
    validate_collection,
)
from orbitdiff.providers.fixture import FixtureProvider
from orbitdiff.providers.instaloader import InstaloaderProvider


def make_collection(
    *, reported_count: int, accounts: tuple[Account, ...], complete: bool = True
) -> Collection:
    return Collection(
        target="atlas_studio",
        reported_count=reported_count,
        accounts=accounts,
        complete=complete,
        collected_at=datetime.now(UTC),
    )


@pytest.mark.parametrize("target", ["", "bad-name", "a" * 31, "atlas studio"])
def test_normalize_target_rejects_invalid_public_usernames(target: str) -> None:
    with pytest.raises(InvalidTargetError):
        normalize_target(target)


def test_fixture_provider_loads_only_local_json_and_deduplicates_accounts(tmp_path: Path) -> None:
    fixture = tmp_path / "fixture.json"
    fixture.write_text(
        json.dumps(
            {
                "target": "atlas_studio",
                "reported_count": 2,
                "complete": True,
                "accounts": [
                    {"profile_id": "1", "username": "pixel_forge"},
                    {"profile_id": "1", "username": "pixel_forge_renamed"},
                    {"profile_id": "2", "username": "nova_labs"},
                ],
            }
        )
    )

    collection = FixtureProvider(fixture).collect("atlas_studio")

    assert {account.profile_id for account in collection.accounts} == {"1", "2"}
    assert collection.complete is True


def test_private_targets_are_rejected_before_get_followees(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session = tmp_path / "saved.session"
    session.write_text("opaque saved session")
    calls = {"get_followees": 0}

    class Profile:
        is_private = True

        @classmethod
        def from_username(cls, _context: object, _target: str) -> Profile:
            return cls()

        def get_followees(self) -> list[object]:
            calls["get_followees"] += 1
            return []

    class Loader:
        context = object()

        def __init__(self, **_kwargs: object) -> None:
            pass

        def load_session_from_file(self, _username: str, _filename: str) -> None:
            return None

    monkeypatch.setitem(sys.modules, "instaloader", SimpleNamespace(Instaloader=Loader, Profile=Profile))

    with pytest.raises(PrivateTargetError):
        InstaloaderProvider("analyst", session).collect("atlas_studio")
    assert calls["get_followees"] == 0


def test_missing_saved_session_is_rejected_without_provider_login(tmp_path: Path) -> None:
    with pytest.raises(SessionUnavailableError):
        InstaloaderProvider("analyst", tmp_path / "missing.session").collect("atlas_studio")


def test_provider_exception_is_exposed_as_collection_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session = tmp_path / "saved.session"
    session.write_text("opaque saved session")

    class Profile:
        is_private = False
        followees = 1

        @classmethod
        def from_username(cls, _context: object, _target: str) -> Profile:
            return cls()

        def get_followees(self) -> list[object]:
            raise RuntimeError("upstream pagination failed")

    class Loader:
        context = object()

        def __init__(self, **_kwargs: object) -> None:
            pass

        def load_session_from_file(self, _username: str, _filename: str) -> None:
            return None

    monkeypatch.setitem(sys.modules, "instaloader", SimpleNamespace(Instaloader=Loader, Profile=Profile))

    with pytest.raises(ProviderError, match="collection failed"):
        InstaloaderProvider("analyst", session).collect("atlas_studio")


def test_provider_collects_only_public_profile_id_and_username(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    session = tmp_path / "saved.session"
    session.write_text("opaque saved session")

    class Followee:
        userid = 7
        username = "pixel_forge"

        def __getattribute__(self, name: str) -> object:
            forbidden = {"fullname", "full_name", "is_verified", "biography", "profile_pic_url"}
            if name in forbidden:
                raise AssertionError(f"forbidden enrichment access: {name}")
            return super().__getattribute__(name)

    class Profile:
        is_private = False
        followees = 1

        @classmethod
        def from_username(cls, _context: object, _target: str) -> Profile:
            return cls()

        def get_followees(self) -> list[Followee]:
            return [Followee()]

    class Loader:
        context = object()

        def __init__(self, **_kwargs: object) -> None:
            pass

        def load_session_from_file(self, _username: str, _filename: str) -> None:
            return None

    monkeypatch.setitem(sys.modules, "instaloader", SimpleNamespace(Instaloader=Loader, Profile=Profile))

    collection = InstaloaderProvider("analyst", session).collect("atlas_studio")

    assert tuple(Account.__dataclass_fields__) == ("profile_id", "username")
    assert collection.accounts == (Account(profile_id="7", username="pixel_forge"),)


def test_validate_collection_rejects_empty_or_below_reported_count_results() -> None:
    with pytest.raises(CollectionIncompleteError, match="empty"):
        validate_collection(make_collection(reported_count=2, accounts=()))
    with pytest.raises(CollectionIncompleteError, match="reported"):
        validate_collection(
            make_collection(
                reported_count=100,
                accounts=tuple(Account(str(index), f"user_{index}") for index in range(94)),
            )
        )


@pytest.mark.parametrize("count", [95, 99, 101])
def test_validate_collection_requires_exact_reported_count(count: int) -> None:
    with pytest.raises(CollectionIncompleteError, match="reported|incomplete"):
        validate_collection(make_collection(
            reported_count=100,
            accounts=tuple(Account(str(index), f"profile_{index}") for index in range(count)),
        ))


def test_nonempty_collection_cannot_claim_zero_reported_count() -> None:
    with pytest.raises(CollectionIncompleteError, match="reported|incomplete"):
        validate_collection(make_collection(reported_count=0, accounts=(Account("1", "nova_labs"),)))


def test_exact_complete_collection_and_exact_empty_collection_are_valid() -> None:
    validate_collection(make_collection(reported_count=1, accounts=(Account("1", "nova_labs"),)))
    validate_collection(make_collection(reported_count=0, accounts=()))


def test_provider_constructor_and_methods_do_not_accept_credentials_or_cookie_material() -> None:
    forbidden = {"password", "cookie", "token", "two_factor", "2fa", "verification_code"}
    public_members = [InstaloaderProvider, InstaloaderProvider.__init__, InstaloaderProvider.collect]
    parameter_names = {
        parameter.name.lower()
        for member in public_members
        for parameter in inspect.signature(member).parameters.values()
        if parameter.name != "self"
    }

    assert parameter_names.isdisjoint(forbidden)
    assert not hasattr(InstaloaderProvider, "login")


def test_live_provider_disables_retries_and_rejects_oversized_reported_list(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = tmp_path / "saved.session"
    session.write_text("opaque saved session")
    settings: dict[str, object] = {}

    class Loader:
        context = object()

        def __init__(self, **kwargs: object) -> None:
            settings.update(kwargs)

        def load_session_from_file(self, _username: str, _filename: str) -> None:
            pass

    class Profile:
        is_private = False
        followees = 100_001

        @classmethod
        def from_username(cls, _context: object, _target: str) -> Profile:
            return cls()

        def get_followees(self) -> list[object]:
            pytest.fail("oversized list must be rejected before pagination")

    monkeypatch.setitem(sys.modules, "instaloader", SimpleNamespace(Instaloader=Loader, Profile=Profile))
    with pytest.raises(CollectionIncompleteError, match="limit"):
        InstaloaderProvider("analyst", session).collect("atlas_studio")
    assert settings["max_connection_attempts"] == 1
    assert settings["request_timeout"] == 20
    assert 429 in settings["fatal_status_codes"]  # type: ignore[operator]
    assert set((301, 302, 303, 307, 308)).issubset(settings["fatal_status_codes"])  # type: ignore[arg-type]


def test_duplicate_stream_cannot_bypass_the_roster_limit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = tmp_path / "saved.session"
    session.write_text("opaque saved session")

    class Loader:
        context = object()

        def __init__(self, **_kwargs: object) -> None:
            pass

        def load_session_from_file(self, _username: str, _filename: str) -> None:
            pass

    class Profile:
        is_private = False
        followees = 1

        @classmethod
        def from_username(cls, _context: object, _target: str) -> Profile:
            return cls()

        def get_followees(self) -> list[object]:
            return [SimpleNamespace(userid=1, username="pixel_forge")] * 4

    monkeypatch.setitem(sys.modules, "instaloader", SimpleNamespace(Instaloader=Loader, Profile=Profile))
    monkeypatch.setattr(live_provider, "MAX_PUBLIC_ACCOUNTS", 3, raising=False)
    with pytest.raises(CollectionIncompleteError, match="limit"):
        InstaloaderProvider("analyst", session).collect("atlas_studio")


def test_rate_controller_stops_instead_of_sleeping_retrying_or_exceeding_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    controller = live_provider._BoundedRateController(SimpleNamespace(), deadline=float("inf"))
    with pytest.raises(ProviderError, match="rate limit"):
        controller.handle_429("other")
    with pytest.raises(ProviderError, match="rate limit"):
        controller.sleep(10)
    monkeypatch.setattr(live_provider, "MAX_QUERY_REQUESTS", 2)
    controller.wait_before_query("other")
    controller.wait_before_query("other")
    with pytest.raises(CollectionIncompleteError, match="request limit"):
        controller.wait_before_query("other")
    deadline = live_provider._BoundedRateController(SimpleNamespace(), deadline=0)
    with pytest.raises(CollectionIncompleteError, match="time limit"):
        deadline.wait_before_query("other")


@pytest.mark.parametrize("status", [302, 429])
def test_actual_provider_transport_stops_on_redirect_or_rate_limit_without_network(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, status: int,
) -> None:
    import instaloader
    import requests

    session = tmp_path / "saved.session"
    session.write_text("opaque saved session")
    requests_seen: list[dict[str, object]] = []

    def request(_self: object, *_args: object, **kwargs: object) -> object:
        requests_seen.append(kwargs)
        return SimpleNamespace(
            status_code=status, headers={"Content-Type": "application/json", "location": "https://www.instagram.com/loop/"},
            reason="blocked", text="{}", is_redirect=status == 302,
        )

    def profile(context: object, _target: str) -> object:
        return context.get_json("synthetic/", {})  # type: ignore[attr-defined]

    monkeypatch.setattr(requests.Session, "request", request)
    monkeypatch.setattr(instaloader.Instaloader, "load_session_from_file", lambda *_args: None)
    monkeypatch.setattr(instaloader.Profile, "from_username", profile)
    monkeypatch.setattr(live_provider.time, "sleep", lambda _secs: pytest.fail("must not sleep or retry"))

    with pytest.raises(ProviderError, match="collection failed"):
        InstaloaderProvider("analyst", session).collect("atlas_studio")

    assert len(requests_seen) == 1
    assert requests_seen[0]["timeout"] == 20
