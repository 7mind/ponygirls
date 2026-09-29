"""Quota snapshot contract and the adapter protocol every provider implements."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from tokemon.credentials import Credential
from tokemon.discovery import Target
from tokemon.transport import Transport


@dataclass(frozen=True)
class QuotaWindow:
    name: str
    used: float | None
    limit: float | None
    unit: str
    resets_at: datetime | None
    unlimited: bool = False
    exhausted: bool | None = None


@dataclass(frozen=True)
class QuotaSnapshot:
    plan_name: str | None
    identity: str | None
    windows: tuple[QuotaWindow, ...]
    note: str | None


class QuotaFetchError(RuntimeError):
    """The quota query completed but could not be interpreted."""


class RateLimitedError(QuotaFetchError):
    """The endpoint answered HTTP 429; ``retry_at`` is from Retry-After, if sent."""

    def __init__(self, url: str, retry_at: datetime | None) -> None:
        super().__init__(f"rate limited (HTTP 429) by {url}")
        self.retry_at = retry_at


@dataclass(frozen=True)
class RateLimit:
    retry_at: datetime | None


class QuotaAdapter(Protocol):
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot: ...


@dataclass(frozen=True)
class QueryResult:
    target: Target
    snapshot: QuotaSnapshot | None
    error: str | None
    fetched_at: datetime
    rate_limit: RateLimit | None


class NoQuotaEndpoint:
    """Fallback for providers with no known quota surface (e.g. Xiaomi token plans)."""

    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        return QuotaSnapshot(plan_name=None, identity=None, windows=(), note="no quota endpoint")
