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
    """A collection failed the complete-list safety threshold."""


class FollowingProvider(Protocol):
    def collect(self, target: str) -> Collection: ...


def normalize_target(target: str) -> str:
    normalized = target.strip().removeprefix("@").lower()
    if not _USERNAME.fullmatch(normalized):
        raise InvalidTargetError("target must be a public Instagram username")
    return normalized


def validate_collection(collection: Collection, minimum_ratio: float = 0.95) -> None:
    if not collection.complete:
        raise CollectionIncompleteError("collection was not complete")
    if collection.reported_count < 0:
        raise CollectionIncompleteError("reported count cannot be negative")
    unique_ids = {account.profile_id for account in collection.accounts}
    if len(unique_ids) != len(collection.accounts):
        raise CollectionIncompleteError("collection contains duplicate public profile IDs")
    if collection.reported_count > 0 and not collection.accounts:
        raise CollectionIncompleteError("reported nonzero following count collected an empty list")
    if collection.reported_count and len(collection.accounts) / collection.reported_count < minimum_ratio:
        raise CollectionIncompleteError(
            f"collection is below the {minimum_ratio:.0%} completeness threshold"
        )
