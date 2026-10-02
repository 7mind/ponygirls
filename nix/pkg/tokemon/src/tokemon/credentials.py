"""Credential model shared by config discovery and quota adapters."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Mapping


class CredentialKind(Enum):
    OAUTH = "oauth"
    API_KEY = "api_key"


class CredentialError(ValueError):
    """A credential entry exists but cannot be interpreted."""


class StoreFormat(Enum):
    """How a refreshed token is written back into ``path``."""

    PI = "pi"
    CLAUDE = "claude"


@dataclass(frozen=True)
class CredentialStore:
    """One credential file entry a refreshed token is written back to."""

    path: Path
    entry: str
    format: StoreFormat


@dataclass(frozen=True)
class Credential:
    kind: CredentialKind
    secret: str
    refresh_token: str | None
    account_id: str | None
    expires_at: datetime | None
    stores: tuple[CredentialStore, ...]

    def is_expired(self, now: datetime) -> bool:
        return self.expires_at is not None and self.expires_at <= now


def _epoch_ms_to_datetime(epoch_ms: Any) -> datetime | None:
    if not isinstance(epoch_ms, (int, float)) or epoch_ms <= 0:
        return None
    return datetime.fromtimestamp(epoch_ms / 1000.0, tz=timezone.utc)


def credential_from_pi_entry(provider_id: str, entry: Mapping[str, Any], store: CredentialStore) -> Credential:
    """Parse one provider entry of a pi ``auth.json`` file."""
    entry_type = entry.get("type")
    if entry_type == "oauth":
        secret = entry.get("access")
        if not isinstance(secret, str) or not secret:
            raise CredentialError(f"pi credential {provider_id!r}: oauth entry has no access token")
        account_id = entry.get("accountId")
        return Credential(
            kind=CredentialKind.OAUTH,
            secret=secret,
            refresh_token=entry.get("refresh") if isinstance(entry.get("refresh"), str) else None,
            account_id=account_id if isinstance(account_id, str) else None,
            expires_at=_epoch_ms_to_datetime(entry.get("expires")),
            stores=(store,),
        )
    if entry_type == "api_key":
        secret = entry.get("key")
        if not isinstance(secret, str) or not secret:
            raise CredentialError(f"pi credential {provider_id!r}: api_key entry has no key")
        return Credential(
            kind=CredentialKind.API_KEY,
            secret=secret,
            refresh_token=None,
            account_id=None,
            expires_at=None,
            stores=(store,),
        )
    raise CredentialError(f"pi credential {provider_id!r}: unknown type {entry_type!r}")


def credential_from_claude_oauth(entry: Mapping[str, Any], store: CredentialStore) -> Credential:
    """Parse the ``claudeAiOauth`` object of a Claude Code ``.credentials.json``."""
    secret = entry.get("accessToken")
    if not isinstance(secret, str) or not secret:
        raise CredentialError("claude credential: claudeAiOauth has no accessToken")
    refresh = entry.get("refreshToken")
    return Credential(
        kind=CredentialKind.OAUTH,
        secret=secret,
        refresh_token=refresh if isinstance(refresh, str) else None,
        account_id=None,
        expires_at=_epoch_ms_to_datetime(entry.get("expiresAt")),
        stores=(store,),
    )


def credential_from_env_api_key(provider_id: str, key: str) -> Credential:
    return Credential(
        kind=CredentialKind.API_KEY, secret=key, refresh_token=None, account_id=None, expires_at=None, stores=()
    )
