"""HTTP 429 handling: Retry-After is parsed, surfaced and respected by refreshes (BA)."""

from __future__ import annotations

import io
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from typing import Mapping

from rich.console import Console

from dummy_transport import json_response
from test_adapters import fixture
from tokemon.adapters.openrouter import OpenRouterQuota
from tokemon.credentials import credential_from_env_api_key
from tokemon.polling import make_query
from tokemon.quota import RateLimitedError
from tokemon.render import build_table
from tokemon.transport import HttpResponse

AUTH_KEY_URL = "https://openrouter.ai/api/v1/auth/key"
T0 = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc)


def rate_limited(retry_after: str | None) -> HttpResponse:
    return HttpResponse(status=429, body=b'{"error": "rate_limited"}', retry_after=retry_after)


class SequenceTransport:
    """Answers each request with the next scripted response."""

    def __init__(self, responses: list[HttpResponse]) -> None:
        self._responses = list(responses)
        self.calls = 0

    def request(self, method: str, url: str, headers: Mapping[str, str], body: bytes | None) -> HttpResponse:
        assert (method, url) == ("GET", AUTH_KEY_URL), (method, url)
        self.calls += 1
        return self._responses.pop(0)


class Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


def _fetch(response: HttpResponse):
    credential = credential_from_env_api_key("openrouter", "k")
    return OpenRouterQuota().fetch(credential, SequenceTransport([response]))


class RetryAfterParsingTests(unittest.TestCase):
    def test_delay_seconds(self):
        before = datetime.now(timezone.utc)
        with self.assertRaises(RateLimitedError) as caught:
            _fetch(rate_limited("120"))
        retry_at = caught.exception.retry_at
        assert retry_at is not None
        self.assertGreaterEqual(retry_at, before + timedelta(seconds=120))
        self.assertLessEqual(retry_at, datetime.now(timezone.utc) + timedelta(seconds=120))

    def test_http_date(self):
        when = datetime(2030, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
        with self.assertRaises(RateLimitedError) as caught:
            _fetch(rate_limited(format_datetime(when, usegmt=True)))
        self.assertEqual(caught.exception.retry_at, when)

    def test_missing_header(self):
        with self.assertRaises(RateLimitedError) as caught:
            _fetch(rate_limited(None))
        self.assertIsNone(caught.exception.retry_at)


class RetryAwareRefreshTests(unittest.TestCase):
    def _query(self, transport: SequenceTransport, clock: Clock):
        home = Path(self._tmp.name)
        return make_query(home, {"OPENROUTER_API_KEY": "k"}, transport, clock)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self._tmp.cleanup()

    def test_rate_limited_target_is_not_requeried_before_retry_after(self):
        ok = json_response(200, fixture("openrouter_auth_key.json"))
        transport = SequenceTransport([rate_limited("60"), ok])
        clock = Clock(T0)
        query = self._query(transport, clock)

        clock.now = datetime.now(timezone.utc)
        first = query()
        self.assertEqual(transport.calls, 1)
        self.assertIsNotNone(first[0].rate_limit)

        clock.now = clock.now + timedelta(seconds=10)
        held = query()
        self.assertEqual(transport.calls, 1, "a refresh inside the Retry-After window must not re-query")
        self.assertEqual(held[0].rate_limit, first[0].rate_limit)

        clock.now = clock.now + timedelta(seconds=61)
        retried = query()
        self.assertEqual(transport.calls, 2)
        self.assertIsNone(retried[0].rate_limit)
        self.assertIsNotNone(retried[0].snapshot)

    def test_rate_limit_without_retry_after_is_retried_on_next_refresh(self):
        ok = json_response(200, fixture("openrouter_auth_key.json"))
        transport = SequenceTransport([rate_limited(None), ok])
        query = self._query(transport, Clock(T0))
        query()
        query()
        self.assertEqual(transport.calls, 2)


class RateLimitedRenderTests(unittest.TestCase):
    def test_rate_limited_row_is_shown_with_countdown(self):
        transport = SequenceTransport([rate_limited("90")])
        with tempfile.TemporaryDirectory() as tmp:
            clock = Clock(datetime.now(timezone.utc))
            results = make_query(Path(tmp), {"OPENROUTER_API_KEY": "k"}, transport, clock)()
        buffer = io.StringIO()
        Console(file=buffer, width=240).print(build_table(results, clock.now, "t", False, False, False))
        text = buffer.getvalue()
        self.assertIn("openrouter", text)
        self.assertIn("rate limited", text)
        self.assertIn("retry in 1m", text)
        self.assertNotIn("hidden", text)


if __name__ == "__main__":
    unittest.main()
