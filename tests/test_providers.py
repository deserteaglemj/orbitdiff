from __future__ import annotations

import inspect
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

from orbitdiff.models import Account, Collection
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

        @classmethod
        def from_username(cls, _context: object, _target: str) -> Profile:
            return cls()

        def get_followees(self) -> list[object]:
            raise RuntimeError("upstream pagination failed")

    class Loader:
        context = object()

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

        def load_session_from_file(self, _username: str, _filename: str) -> None:
            return None

    monkeypatch.setitem(sys.modules, "instaloader", SimpleNamespace(Instaloader=Loader, Profile=Profile))

    collection = InstaloaderProvider("analyst", session).collect("atlas_studio")

    assert tuple(Account.__dataclass_fields__) == ("profile_id", "username")
    assert collection.accounts == (Account(profile_id="7", username="pixel_forge"),)


def test_validate_collection_rejects_empty_or_below_95_percent_results() -> None:
    with pytest.raises(CollectionIncompleteError, match="empty"):
        validate_collection(make_collection(reported_count=2, accounts=()))
    with pytest.raises(CollectionIncompleteError, match="95%"):
        validate_collection(
            make_collection(
                reported_count=100,
                accounts=tuple(Account(str(index), f"user_{index}") for index in range(94)),
            )
        )


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
