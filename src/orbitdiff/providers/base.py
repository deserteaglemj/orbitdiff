from __future__ import annotations

import re
from typing import Protocol

from orbitdiff.models import Collection

_USERNAME = re.compile(r"^[A-Za-z0-9._]{1,30}$")


class ProviderError(RuntimeError):
    """A saved-session collection could not complete safely."""


class InvalidTargetError(ProviderError):
    """The target is not a supported public Instagram username."""


class PrivateTargetError(ProviderError):
    """The target is private and is outside OrbitDiff's scope."""


class SessionUnavailableError(ProviderError):
    """No human-created saved session file is available."""


class CollectionIncompleteError(ProviderError):
    """A collection did not establish a complete public following list."""


class FollowingProvider(Protocol):
    def collect(self, target: str) -> Collection: ...


def normalize_target(target: str) -> str:
    normalized = target.strip().removeprefix("@").lower()
    if not _USERNAME.fullmatch(normalized):
        raise InvalidTargetError("target must be a public Instagram username")
    return normalized


def validate_collection(collection: Collection) -> None:
    if collection.complete is not True:
        raise CollectionIncompleteError("collection was not complete")
    if type(collection.reported_count) is not int or collection.reported_count < 0:
        raise CollectionIncompleteError("reported count must be a nonnegative integer")
    if any(not isinstance(account.profile_id, str) or not account.profile_id for account in collection.accounts):
        raise CollectionIncompleteError("accounts require a stable public profile ID")
    unique_ids = {account.profile_id for account in collection.accounts}
    if len(unique_ids) != len(collection.accounts):
        raise CollectionIncompleteError("collection contains duplicate public profile IDs")
    if collection.reported_count > 0 and not collection.accounts:
        raise CollectionIncompleteError("reported nonzero following count collected an empty list")
    if len(collection.accounts) != collection.reported_count:
        raise CollectionIncompleteError(
            "collection count does not match the reported following count; the list is incomplete"
        )
