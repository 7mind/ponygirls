"""Expired-token refresh over a synthetic pi auth.json and a scripted token endpoint (BA).

The token-endpoint payloads are synthetic, built from the request/response
handling of pi's own xAI refresh (pi-ai auth/oauth/xai.ts).
"""

from __future__ import annotations

import json
import os
import stat
import tempfile
import time
import unittest
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dummy_transport import ScriptedTransport, json_response
from test_adapters import fixture
from tokemon.adapters import TOKEN_ENDPOINTS
from tokemon.discovery import discover_targets
from tokemon.main import _parse_args, token_policy
from tokemon.polling import query_target
from tokemon.token_refresh import KeepExpiredTokens, RefreshExpiredTokens, TokenRefreshError

TOKEN_URL = "https://auth.x.ai/oauth2/token"
USER_URL = "https://cli-chat-proxy.grok.com/v1/user?include=subscription"
BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"
NOW = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
EXPIRED_MS = int((NOW - timedelta(days=60)).timestamp() * 1000)
VALID_MS = int((NOW + timedelta(hours=1)).timestamp() * 1000)
LOCK_WAIT_SECONDS = 0.2
ROTATED = {"access_token": "new-access", "refresh_token": "new-refresh", "expires_in": 7200}


def _entry(expires_ms: int) -> dict:
    return {"type": "oauth", "access": "old-access", "refresh": "old-refresh", "expires": expires_ms, "source": "kept"}


class TokenRefreshTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name)
        self.auth_path = self.home / ".pi" / "agent" / "auth.json"
        self.policy = RefreshExpiredTokens(TOKEN_ENDPOINTS, LOCK_WAIT_SECONDS)

    def tearDown(self):
        self._tmp.cleanup()

    def _write(self, path: Path, auth: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(auth), encoding="utf-8")

    def _target(self, provider: str):
        (target,) = [t for t in discover_targets(self.home, {}) if t.provider == provider]
        return target

    def _current(self, provider: str, token_response: object):
        transport = ScriptedTransport({("POST", TOKEN_URL): token_response})
        target = self._target(provider)
        return self.policy.current(provider, target.credential, transport, NOW), transport

    def test_expired_token_is_refreshed_and_written_back(self):
        other = {"type": "api_key", "key": "or-key"}
        self._write(self.auth_path, {"xai": _entry(EXPIRED_MS), "openrouter": other})
        credential, transport = self._current("xai", json_response(200, ROTATED))

        self.assertEqual((credential.secret, credential.refresh_token), ("new-access", "new-refresh"))
        self.assertEqual(credential.expires_at, NOW + timedelta(seconds=7200) - timedelta(minutes=5))
        self.assertEqual(
            urllib.parse.parse_qs(transport.bodies[0].decode("ascii")),
            {
                "grant_type": ["refresh_token"],
                "client_id": ["b1a00492-073a-47ea-816f-4c329264a828"],
                "refresh_token": ["old-refresh"],
            },
        )
        stored = json.loads(self.auth_path.read_text(encoding="utf-8"))
        self.assertEqual(
            stored["xai"],
            {
                "type": "oauth",
                "access": "new-access",
                "refresh": "new-refresh",
                "expires": int(credential.expires_at.timestamp() * 1000),
                "source": "kept",
            },
        )
        self.assertEqual(stored["openrouter"], other)
        self.assertEqual(stat.S_IMODE(self.auth_path.stat().st_mode), 0o600)
        self.assertEqual(sorted(p.name for p in self.auth_path.parent.iterdir()), ["auth.json"])

    def test_unrotated_refresh_token_and_default_lifetime(self):
        self._write(self.auth_path, {"xai": _entry(EXPIRED_MS)})
        credential, _ = self._current("xai", json_response(200, {"access_token": "new-access"}))
        self.assertEqual(credential.refresh_token, "old-refresh")
        self.assertEqual(credential.expires_at, NOW + timedelta(hours=1) - timedelta(minutes=5))
        self.assertEqual(json.loads(self.auth_path.read_text(encoding="utf-8"))["xai"]["refresh"], "old-refresh")

    def test_rejected_refresh_raises_and_leaves_the_file_untouched(self):
        self._write(self.auth_path, {"xai": _entry(EXPIRED_MS)})
        before = self.auth_path.read_bytes()
        rejected = json_response(400, {"error": "invalid_grant", "error_description": "token expired"})
        with self.assertRaises(TokenRefreshError) as caught:
            self._current("xai", rejected)
        self.assertIn("HTTP 400: invalid_grant: token expired", str(caught.exception))
        self.assertEqual(self.auth_path.read_bytes(), before)
        self.assertFalse((self.auth_path.parent / "auth.json.lock").exists())

    def test_response_without_access_token_raises(self):
        self._write(self.auth_path, {"xai": _entry(EXPIRED_MS)})
        with self.assertRaises(TokenRefreshError):
            self._current("xai", json_response(200, {"refresh_token": "new-refresh"}))

    def test_valid_token_is_left_alone(self):
        self._write(self.auth_path, {"xai": _entry(VALID_MS)})
        credential, transport = self._current("xai", json_response(200, ROTATED))
        self.assertEqual(credential.secret, "old-access")
        self.assertEqual(transport.calls, [])

    def test_provider_without_token_endpoint_is_left_alone(self):
        self._write(self.auth_path, {"kimi-coding": _entry(EXPIRED_MS)})
        credential, transport = self._current("kimi-coding", json_response(200, ROTATED))
        self.assertEqual(credential.secret, "old-access")
        self.assertEqual(transport.calls, [])

    def test_refresh_is_the_default_and_can_be_disabled(self):
        self.assertIsInstance(token_policy(True), RefreshExpiredTokens)
        self.assertIsInstance(token_policy(False), KeepExpiredTokens)
        self.assertTrue(_parse_args([]).refresh_tokens)
        self.assertTrue(_parse_args(["--refresh-tokens"]).refresh_tokens)
        self.assertFalse(_parse_args(["--no-refresh-tokens"]).refresh_tokens)

    def test_keep_policy_never_refreshes(self):
        self._write(self.auth_path, {"xai": _entry(EXPIRED_MS)})
        target = self._target("xai")
        transport = ScriptedTransport({})
        self.assertIs(KeepExpiredTokens().current("xai", target.credential, transport, NOW), target.credential)
        self.assertEqual(transport.calls, [])

    def test_login_refreshed_by_pi_since_discovery_is_used_as_stored(self):
        self._write(self.auth_path, {"xai": _entry(EXPIRED_MS)})
        target = self._target("xai")
        by_pi = {"type": "oauth", "access": "pi-access", "refresh": "pi-refresh", "expires": VALID_MS}
        self._write(self.auth_path, {"xai": by_pi})
        transport = ScriptedTransport({})
        credential = self.policy.current("xai", target.credential, transport, NOW)
        self.assertEqual((credential.secret, credential.refresh_token), ("pi-access", "pi-refresh"))
        self.assertEqual(transport.calls, [])

    def test_identical_copies_in_other_agent_dirs_receive_the_new_token(self):
        copy_path = self.home / ".pi" / "other" / "auth.json"
        self._write(self.auth_path, {"xai": _entry(EXPIRED_MS)})
        self._write(copy_path, {"xai": _entry(EXPIRED_MS)})
        _, transport = self._current("xai", json_response(200, ROTATED))
        self.assertEqual(len(transport.calls), 1)
        for path in (self.auth_path, copy_path):
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["xai"]["refresh"], "new-refresh")

    def test_lock_held_by_another_process_fails_without_refreshing(self):
        self._write(self.auth_path, {"xai": _entry(EXPIRED_MS)})
        lock = self.auth_path.parent / "auth.json.lock"
        lock.mkdir()
        with self.assertRaises(TokenRefreshError) as caught:
            self._current("xai", TokenRefreshError("token endpoint must not be reached"))
        self.assertIn("locked", str(caught.exception))
        self.assertTrue(lock.is_dir())

    def test_stale_lock_is_taken_over(self):
        self._write(self.auth_path, {"xai": _entry(EXPIRED_MS)})
        lock = self.auth_path.parent / "auth.json.lock"
        lock.mkdir()
        abandoned = time.time() - 60
        os.utime(lock, (abandoned, abandoned))
        credential, _ = self._current("xai", json_response(200, ROTATED))
        self.assertEqual(credential.secret, "new-access")
        self.assertFalse(lock.exists())

    def test_query_uses_the_refreshed_token_and_reports_it_unexpired(self):
        self._write(self.auth_path, {"xai": _entry(EXPIRED_MS)})
        transport = ScriptedTransport(
            {
                ("POST", TOKEN_URL): json_response(200, ROTATED),
                ("GET", USER_URL): json_response(200, {"userId": "u-1"}),
                ("GET", BILLING_URL): json_response(200, fixture("grok_billing_credits.json")),
            }
        )
        result = query_target(self._target("xai"), transport, self.policy)
        self.assertIsNone(result.error)
        self.assertEqual(transport.headers[1]["Authorization"], "Bearer new-access")
        self.assertFalse(result.target.credential.is_expired(datetime.now(timezone.utc)))

    def test_failed_refresh_becomes_the_row_error(self):
        self._write(self.auth_path, {"xai": _entry(EXPIRED_MS)})
        transport = ScriptedTransport({("POST", TOKEN_URL): json_response(400, {"error": "invalid_grant"})})
        result = query_target(self._target("xai"), transport, self.policy)
        self.assertIn("log in to xAI again", result.error)
        self.assertEqual(transport.calls, [("POST", TOKEN_URL)])


if __name__ == "__main__":
    unittest.main()
