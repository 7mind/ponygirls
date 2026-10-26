"""Claude OAuth GETs are reserved in the ledger before they hit the network (BA)."""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Mapping

from tokemon.adapters.claude import ClaudeQuota
from tokemon.credentials import Credential, CredentialKind
from tokemon.state import QueryLedger
from tokemon.polling import make_query
from tokemon.token_refresh import KeepExpiredTokens
from tokemon.pacing import CLAUDE_MIN_QUERY_INTERVAL, CLAUDE_RATE_LIMIT_BACKOFF, PacedTransport
from tokemon.transport import HttpResponse, TransportError

USAGE = "https://api.anthropic.com/api/oauth/usage"
PROFILE = "https://api.anthropic.com/api/oauth/profile"
NOW = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
HEADERS = {"Authorization": "Bearer token-a"}


class ScriptedInner:
    def __init__(self, responses: list[HttpResponse | Exception]) -> None:
        self._responses = list(responses)
        self.calls: list[str] = []

    def request(self, method: str, url: str, headers: Mapping[str, str], body: bytes | None) -> HttpResponse:
        self.calls.append(url)
        outcome = self._responses.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def _ok(payload: bytes = b'{"limits":[]}') -> HttpResponse:
    return HttpResponse(status=200, body=payload, retry_after=None)


def _limited(retry_after: str | None) -> HttpResponse:
    return HttpResponse(status=429, body=b'{"error":"rate_limited"}', retry_after=retry_after)


class Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


class PacedTransportTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.path = Path(self._tmp.name) / "state.sqlite"
        self.clock = Clock(NOW)

    def tearDown(self):
        self._tmp.cleanup()

    def _transport(self, responses: list[HttpResponse | Exception]) -> tuple[PacedTransport, ScriptedInner]:
        inner = ScriptedInner(responses)
        return PacedTransport(inner, self.path, self.clock), inner

    def test_reader_rechecks_shared_cache_after_cold_inflight_response(self):
        home = Path(self._tmp.name)
        agent = home / ".pi" / "agent"
        agent.mkdir(parents=True)
        (agent / "auth.json").write_text(json.dumps({"anthropic": {"type": "oauth", "access": "token-a", "refresh": "r", "expires": 9999999999999}}))
        self.clock.now = datetime.now(timezone.utc)
        now = self.clock.now
        key = hashlib.sha256(HEADERS["Authorization"].encode()).hexdigest()
        ledger = QueryLedger(self.path, CLAUDE_MIN_QUERY_INTERVAL)
        ledger.try_claim(USAGE, key, now)
        transport, inner = self._transport([])
        query = make_query(home, {}, transport, self.clock, KeepExpiredTokens())
        self.assertIsNotNone(query()[0].rate_limit)
        ledger.record(USAGE, key, 200, b'{"five_hour":{"utilization":42}}', now + CLAUDE_MIN_QUERY_INTERVAL, now)
        ledger.try_claim(PROFILE, key, now)
        ledger.record(PROFILE, key, 200, b'{}', now + CLAUDE_MIN_QUERY_INTERVAL, now)
        self.assertIsNotNone(query()[0].snapshot)
        self.assertEqual(inner.calls, [])

    def test_cached_usage_survives_an_inflight_profile_without_a_cached_profile(self):
        ledger = QueryLedger(self.path, CLAUDE_MIN_QUERY_INTERVAL)
        key = hashlib.sha256(HEADERS["Authorization"].encode()).hexdigest()
        ledger.try_claim(USAGE, key, NOW)
        ledger.record(USAGE, key, 200, b'{"five_hour":{"utilization":42}}', NOW + CLAUDE_MIN_QUERY_INTERVAL, NOW)
        ledger.try_claim(PROFILE, key, NOW)
        transport, inner = self._transport([])
        credential = Credential(kind=CredentialKind.OAUTH, secret="token-a", refresh_token=None, account_id=None, expires_at=None, stores=())
        snapshot = ClaudeQuota().fetch(credential, transport)
        self.assertEqual(snapshot.windows[0].used, 42)
        self.assertIn("profile unavailable", snapshot.note)
        self.assertEqual(inner.calls, [])

    def test_non_claude_urls_are_not_paced(self):
        transport, inner = self._transport([_ok(), _ok()])
        transport.request("GET", "https://api.x.ai/v1/user", HEADERS, None)
        transport.request("GET", "https://api.x.ai/v1/user", HEADERS, None)
        self.assertEqual(inner.calls, ["https://api.x.ai/v1/user", "https://api.x.ai/v1/user"])

    def test_second_query_inside_the_interval_replays_the_cached_body(self):
        transport, inner = self._transport([_ok(b'{"used":1}')])
        first = transport.request("GET", USAGE, HEADERS, None)
        self.clock.now = NOW + timedelta(seconds=30)
        second = transport.request("GET", USAGE, HEADERS, None)
        self.assertEqual(inner.calls, [USAGE])
        self.assertEqual(second.body, first.body)

    def test_a_different_token_has_its_own_slot(self):
        transport, inner = self._transport([_ok(), _ok()])
        transport.request("GET", USAGE, HEADERS, None)
        transport.request("GET", USAGE, {"Authorization": "Bearer token-b"}, None)
        self.assertEqual(inner.calls, [USAGE, USAGE])

    def test_usage_and_profile_are_paced_separately(self):
        transport, inner = self._transport([_ok(), _ok()])
        transport.request("GET", USAGE, HEADERS, None)
        transport.request("GET", PROFILE, HEADERS, None)
        self.assertEqual(inner.calls, [USAGE, PROFILE])

    def test_rate_limit_without_retry_after_backs_off_and_replays_the_last_success(self):
        transport, inner = self._transport([_ok(b'{"used":1}'), _limited(None)])
        transport.request("GET", USAGE, HEADERS, None)
        self.clock.now = NOW + CLAUDE_MIN_QUERY_INTERVAL
        replayed = transport.request("GET", USAGE, HEADERS, None)
        self.assertEqual(replayed.body, b'{"used":1}')
        self.clock.now = NOW + CLAUDE_MIN_QUERY_INTERVAL + timedelta(minutes=1)
        held = transport.request("GET", USAGE, HEADERS, None)
        self.assertEqual(inner.calls, [USAGE, USAGE])
        self.assertEqual(held.status, 200)
        self.clock.now = NOW + CLAUDE_MIN_QUERY_INTERVAL + CLAUDE_RATE_LIMIT_BACKOFF
        again, later = self._transport([_ok(b'{"used":2}')])
        response = again.request("GET", USAGE, HEADERS, None)
        self.assertEqual(later.calls, [USAGE])
        self.assertEqual(response.body, b'{"used":2}')

    def test_retry_after_zero_does_not_permit_an_immediate_retry(self):
        transport, inner = self._transport([_limited("0")])
        response = transport.request("GET", USAGE, HEADERS, None)
        self.assertEqual(response.status, 429)
        self.assertGreaterEqual(int(response.retry_after or "0"), 60)
        self.clock.now = NOW + timedelta(seconds=1)
        held = transport.request("GET", USAGE, HEADERS, None)
        self.assertEqual(inner.calls, [USAGE])
        self.assertEqual(held.status, 429)
        self.assertGreaterEqual(int(held.retry_after or "0"), 60)

    def test_transport_error_with_a_cached_body_replays_it(self):
        transport, inner = self._transport([_ok(b'{"used":1}'), TransportError("down")])
        transport.request("GET", USAGE, HEADERS, None)
        self.clock.now = NOW + CLAUDE_MIN_QUERY_INTERVAL
        replayed = transport.request("GET", USAGE, HEADERS, None)
        self.assertEqual(replayed.body, b'{"used":1}')
        self.assertEqual(len(inner.calls), 2)
        self.assertTrue(replayed.cached)
        self.assertEqual(replayed.fetched_at, NOW)

    def test_all_failed_statuses_replay_success_with_original_timestamp(self):
        for status in (401, 403, 429, 500, 503):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "state.sqlite"
                clock = Clock(NOW)
                inner = ScriptedInner([_ok(b'{"used":1}'), HttpResponse(status, b'failed', None)])
                transport = PacedTransport(inner, path, clock)
                fresh = transport.request("GET", USAGE, HEADERS, None)
                clock.now += CLAUDE_MIN_QUERY_INTERVAL
                replay = transport.request("GET", USAGE, HEADERS, None)
                self.assertEqual(replay.status, 200)
                self.assertEqual(replay.body, fresh.body)
                self.assertFalse(fresh.cached)
                self.assertEqual(fresh.fetched_at, NOW)
                self.assertTrue(replay.cached)
                self.assertEqual(replay.fetched_at, NOW)
                # A separate process/transport sees the same persisted success age.
                other = PacedTransport(ScriptedInner([]), path, clock)
                held = other.request("GET", USAGE, HEADERS, None)
                self.assertEqual(held.fetched_at, NOW)
                self.assertTrue(held.cached)

    def test_no_cached_success_preserves_http_failure(self):
        transport, _ = self._transport([HttpResponse(500, b'failed', None)])
        response = transport.request("GET", USAGE, HEADERS, None)
        self.assertEqual(response.status, 500)
        self.assertFalse(response.cached)

    def test_authorization_is_hashed_and_never_persisted(self):
        import hashlib
        import sqlite3
        from contextlib import closing
        transport, _ = self._transport([_ok()])
        transport.request("GET", USAGE, HEADERS, None)
        with closing(sqlite3.connect(self.path)) as db:
            row = db.execute("SELECT endpoint, credential_key, queried_at, next_allowed_at, fetched_at FROM endpoint_queries").fetchone()
        self.assertEqual(row, (USAGE, hashlib.sha256(b"Bearer token-a").hexdigest(),
                               NOW.timestamp(), (NOW + CLAUDE_MIN_QUERY_INTERVAL).timestamp(), NOW.timestamp()))
        self.assertNotIn(b"Bearer token-a", self.path.read_bytes())

    def test_transport_error_without_cache_keeps_reservation(self):
        transport, inner = self._transport([TransportError("down")])
        with self.assertRaises(TransportError):
            transport.request("GET", USAGE, HEADERS, None)
        held = transport.request("GET", USAGE, HEADERS, None)
        self.assertEqual(held.status, 429)
        self.assertEqual(inner.calls, [USAGE])


if __name__ == "__main__":
    unittest.main()
