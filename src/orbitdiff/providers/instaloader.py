from __future__ import annotations

import importlib
from datetime import UTC, datetime
from pathlib import Path

from orbitdiff.models import Account, Collection
from orbitdiff.providers.base import (
    PrivateTargetError,
    ProviderError,
    SessionUnavailableError,
    normalize_target,
    validate_collection,
)


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
            loader = instaloader.Instaloader()
            loader.load_session_from_file(self.login_username, str(session_path))
            profile = instaloader.Profile.from_username(loader.context, target)
            if bool(profile.is_private):
                raise PrivateTargetError("private targets are not supported")
            accounts_by_id: dict[str, Account] = {}
            for profile_account in profile.get_followees():
                account = Account(
                    profile_id=str(profile_account.userid),
                    username=str(profile_account.username),
                )
                accounts_by_id[account.profile_id] = account
            collection = Collection(
                target=target,
                reported_count=int(profile.followees),
                accounts=tuple(accounts_by_id.values()),
                complete=True,
                collected_at=datetime.now(UTC),
            )
        except PrivateTargetError:
            raise
        except Exception as error:
            raise ProviderError("public following collection failed") from error
        validate_collection(collection)
        return collection
