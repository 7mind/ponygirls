"""Keep Claude OAuth quota calls off the rate-limit bucket.

``/api/oauth/usage`` is limited per access token, often with ``Retry-After: 0``
or no header at all, and a 429 can stick for the rest of a session
(anthropics/claude-code#30930, #31637). The in-process retry window is not
enough: a restart or a second tokemon instance would query again immediately.
Every Claude OAuth GET is reserved in the shared ledger first; the reservation
is the minimum gap, and a 429 pushes the next attempt out by the backoff even
when the server names no retry time. Claude Code polls the same token from
its own process, which this ledger cannot see.
"""

from __future__ import annotations

import hashlib
import math
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, Mapping

from tokemon.adapters.claude import ANTHROPIC_OAUTH_API
from tokemon.adapters.common import parse_retry_after
from tokemon.state import QueryLedger
from tokemon.transport import HttpResponse, Transport, TransportError

# Matches tokemon's default refresh. Shorter polls are what trip the bucket.
CLAUDE_MIN_QUERY_INTERVAL = timedelta(minutes=5)
# A 429 with Retry-After 0 is not permission to retry. Observed stuck periods
# outlast a 5-minute retry, so the floor after a 429 is longer than the gap.
CLAUDE_RATE_LIMIT_BACKOFF = timedelta(minutes=30)
HTTP_OK = 200
HTTP_TOO_MANY_REQUESTS = 429
RATE_LIMITED_BODY = b'{"error":"rate_limited"}'


def _credential_key(headers: Mapping[str, str]) -> str | None:
    authorization = headers.get("Authorization")
    if not authorization:
        return None
    return hashlib.sha256(authorization.encode("utf-8")).hexdigest()


def _wait_response(next_allowed_at: datetime, now: datetime) -> HttpResponse:
    seconds = max(1, math.ceil((next_allowed_at - now).total_seconds()))
    return HttpResponse(status=HTTP_TOO_MANY_REQUESTS, body=RATE_LIMITED_BODY, retry_after=str(seconds))


def _cached(body: bytes) -> HttpResponse:
    return HttpResponse(status=HTTP_OK, body=body, retry_after=None)


class PacedTransport:
    """Transport that refuses to re-query a Claude OAuth URL inside the ledger window."""

    def __init__(self, inner: Transport, ledger_path: Path, clock: Callable[[], datetime]) -> None:
        self._inner = inner
        self._ledger = QueryLedger(ledger_path, CLAUDE_MIN_QUERY_INTERVAL)
        self._clock = clock

    def request(self, method: str, url: str, headers: Mapping[str, str], body: bytes | None) -> HttpResponse:
        key = _credential_key(headers)
        if method != "GET" or key is None or not url.startswith(f"{ANTHROPIC_OAUTH_API}/"):
            return self._inner.request(method, url, headers, body)
        now = self._clock()
        claim = self._ledger.try_claim(url, key, now)
        if not claim.proceed:
            if claim.body is not None:
                return _cached(claim.body)
            return _wait_response(claim.next_allowed_at, now)
        try:
            response = self._inner.request(method, url, headers, body)
        except TransportError:
            if claim.body is not None:
                return _cached(claim.body)
            raise
        next_allowed = self._next_allowed(response, now)
        self._ledger.record(url, key, response.status, response.body, next_allowed, now)
        if response.status != HTTP_TOO_MANY_REQUESTS:
            return response
        if claim.body is not None:
            return _cached(claim.body)
        return _wait_response(next_allowed, now)

    def _next_allowed(self, response: HttpResponse, now: datetime) -> datetime:
        if response.status != HTTP_TOO_MANY_REQUESTS:
            return now + CLAUDE_MIN_QUERY_INTERVAL
        floor = now + CLAUDE_RATE_LIMIT_BACKOFF
        retry_at = parse_retry_after(response.retry_after, now)
        if retry_at is not None and retry_at > floor:
            return retry_at
        return floor
