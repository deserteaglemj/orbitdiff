from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from orbitdiff.models import Account, Collection
from orbitdiff.providers.base import ProviderError, normalize_target, validate_collection


class FixtureProvider:
    """Offline provider for deterministic tests and the bundled demo."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def collect(self, target: str) -> Collection:
        target = normalize_target(target)
        if self.path.suffix != ".json" or not self.path.is_file():
            raise ProviderError("fixture provider requires a local JSON file")
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            if normalize_target(str(payload["target"])) != target:
                raise ProviderError("fixture target does not match requested target")
            deduplicated = {
                str(item["profile_id"]): Account(
                    profile_id=str(item["profile_id"]),
                    username=str(item["username"]),
                )
                for item in payload["accounts"]
            }
            collection = Collection(
                target=target,
                reported_count=int(payload["reported_count"]),
                accounts=tuple(deduplicated.values()),
                complete=bool(payload["complete"]),
                collected_at=datetime.now(UTC),
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise ProviderError("fixture is not a valid synthetic collection") from error
        validate_collection(collection)
        return collection
