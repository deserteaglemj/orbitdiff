from __future__ import annotations

import importlib
import time
from datetime import UTC, datetime
from pathlib import Path

from instaloader import InstaloaderContext, RateController

from orbitdiff.models import Account, Collection
from orbitdiff.providers.base import (
    CollectionIncompleteError,
    PrivateTargetError,
    ProviderError,
    SessionUnavailableError,
    normalize_target,
    validate_collection,
)

MAX_PUBLIC_ACCOUNTS = 10_000
MAX_QUERY_REQUESTS = 100
REQUEST_TIMEOUT_SECONDS = 20
COLLECTION_DEADLINE_SECONDS = 120


class _BoundedRateController(RateController):
    """Honor provider rate limits by stopping, with no automated sleep/retry.

    A collection permits at most 100 queries and 10,000 yielded accounts.
    Check the 120-second deadline before each query and yielded account.
    Individual HTTP requests use a 20-second inactivity timeout.
    """

    def __init__(self, context: InstaloaderContext, *, deadline: float) -> None:
        super().__init__(context)
        self._deadline = deadline
        self._requests = 0

    def wait_before_query(self, query_type: str) -> None:
        if time.monotonic() >= self._deadline:
            raise CollectionIncompleteError("public following collection reached its time limit")
        if self._requests >= MAX_QUERY_REQUESTS:
            raise CollectionIncompleteError("public following collection reached its request limit")
        super().wait_before_query(query_type)
        self._requests += 1

    def handle_429(self, query_type: str) -> None:
        raise ProviderError("public following rate limit reached; stop and retry later")

    def sleep(self, secs: float) -> None:
        if secs > 0:
            raise ProviderError("public following rate limit requires waiting; stop and retry later")


class InstaloaderProvider:
    """Read public following lists through a human-created saved session only."""

    def __init__(self, login_username: str, session_file: Path | None = None) -> None:
        self.login_username = login_username
        self.session_file = session_file

    def collect(self, target: str) -> Collection:
        target = normalize_target(target)
        try:
            instaloader = importlib.import_module("instaloader")
        except ImportError as error:
            raise ProviderError("Instaloader is unavailable") from error

        if self.session_file is not None:
            session_path = self.session_file
        else:
            command_module = importlib.import_module("instaloader.__main__")
            session_path = Path(command_module.get_default_session_filename(self.login_username))
        if not session_path.is_file():
            raise SessionUnavailableError("saved Instaloader session file was not found")

        try:
            deadline = time.monotonic() + COLLECTION_DEADLINE_SECONDS
            loader = instaloader.Instaloader(
                sleep=False, quiet=True, max_connection_attempts=1,
                request_timeout=REQUEST_TIMEOUT_SECONDS,
                fatal_status_codes=[301, 302, 303, 307, 308, 429],
                rate_controller=lambda context: _BoundedRateController(context, deadline=deadline),
                download_pictures=False, download_videos=False, download_video_thumbnails=False,
                download_geotags=False, download_comments=False, save_metadata=False,
            )
            loader.load_session_from_file(self.login_username, str(session_path))
            profile = instaloader.Profile.from_username(loader.context, target)
            if bool(profile.is_private):
                raise PrivateTargetError("private targets are not supported")
            reported_count = int(profile.followees)
            if not 0 <= reported_count <= MAX_PUBLIC_ACCOUNTS:
                raise CollectionIncompleteError("public following list exceeds the account limit")
            accounts_by_id: dict[str, Account] = {}
            for count, profile_account in enumerate(profile.get_followees(), start=1):
                if count > MAX_PUBLIC_ACCOUNTS:
                    raise CollectionIncompleteError("public following list exceeds the account limit")
                if time.monotonic() >= deadline:
                    raise CollectionIncompleteError("public following collection reached its time limit")
                account = Account(
                    profile_id=str(profile_account.userid),
                    username=str(profile_account.username),
                )
                accounts_by_id[account.profile_id] = account
            collection = Collection(
                target=target,
                reported_count=reported_count,
                accounts=tuple(accounts_by_id.values()),
                complete=True,
                collected_at=datetime.now(UTC),
            )
        except ProviderError:
            raise
        except Exception as error:
            raise ProviderError("public following collection failed") from error
        validate_collection(collection)
        return collection
