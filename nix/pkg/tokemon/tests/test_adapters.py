"""Adapter tests over a scripted dummy Transport (BA).

Fixture origins:
- codex_wham_usage.json, claude_oauth_usage.json, claude_oauth_profile.json,
  copilot_user.json, zai_no_coding_plan.json,
  minimax_remains_null.json — sanitized live responses (2026-09-29).
- zai_limits.json, openrouter_auth_key.json — synthetic payloads built from the
  documented / official-source response shapes.
"""

from __future__ import annotations

import json
import pathlib
import unittest
from datetime import datetime, timezone

from dummy_transport import ScriptedTransport, json_response

from tokemon.adapters.claude import ClaudeQuota
from tokemon.adapters.codex import CodexQuota
from tokemon.adapters.copilot import CopilotQuota
from tokemon.adapters.kimi import KimiQuota
from tokemon.adapters.minimax import MinimaxQuota
from tokemon.adapters.openrouter import OpenRouterQuota
from tokemon.adapters.zai import ZaiQuota
from tokemon.credentials import Credential, CredentialKind
from tokemon.quota import QuotaFetchError
from tokemon.transport import TransportError

FIXTURES = pathlib.Path(__file__).parent / "fixtures"

API_KEY = Credential(kind=CredentialKind.API_KEY, secret="test-key", refresh_token=None, account_id=None, expires_at=None)
OAUTH = Credential(
    kind=CredentialKind.OAUTH,
    secret="test-access",
    refresh_token="test-refresh",
    account_id="test-account",
    expires_at=None,
)


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class ClaudeAdapterTests(unittest.TestCase):
    USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
    PROFILE_URL = "https://api.anthropic.com/api/oauth/profile"

    def _fetch(self, usage: object, profile: object, credential: Credential = OAUTH):
        transport = ScriptedTransport(
            {
                ("GET", self.USAGE_URL): json_response(200, usage),
                ("GET", self.PROFILE_URL): json_response(200, profile),
            }
        )
        return ClaudeQuota().fetch(credential, transport), transport

    def test_parses_observed_schema(self):
        usage = fixture("claude_oauth_usage.json")
        snapshot, _ = self._fetch(usage, fixture("claude_oauth_profile.json"))
        self.assertEqual(snapshot.plan_name, "claude_team")
        self.assertEqual(snapshot.identity, "user@example.test")
        self.assertEqual(
            [(w.name, w.used, w.limit, w.unit) for w in snapshot.windows],
            [
                ("session (5h)", 22.0, 100.0, "%"),
                ("weekly (7d)", 18.0, 100.0, "%"),
                ("weekly (7d) Fable", 0.0, 100.0, "%"),
            ],
        )
        self.assertEqual(
            snapshot.windows[0].resets_at, datetime.fromisoformat(usage["limits"][0]["resets_at"])
        )
        self.assertEqual(snapshot.windows[0].resets_at.tzinfo, timezone.utc)

    def test_missing_limits_raises(self):
        usage = fixture("claude_oauth_usage.json")
        del usage["limits"]
        with self.assertRaises(QuotaFetchError):
            self._fetch(usage, fixture("claude_oauth_profile.json"))

    def test_api_key_skips_network_with_note(self):
        snapshot, transport = self._fetch({}, {}, API_KEY)
        self.assertEqual(transport.calls, [])
        self.assertEqual(snapshot.windows, ())
        self.assertIn("API key", snapshot.note)

    def test_rejected_token_raises(self):
        transport = ScriptedTransport({("GET", self.USAGE_URL): json_response(401, {"error": "expired"})})
        with self.assertRaises(QuotaFetchError):
            ClaudeQuota().fetch(OAUTH, transport)


class CodexAdapterTests(unittest.TestCase):
    def _fetch(self, payload: object):
        transport = ScriptedTransport({("GET", "https://chatgpt.com/backend-api/wham/usage"): json_response(200, payload)})
        return CodexQuota().fetch(OAUTH, transport)

    def test_parses_observed_schema(self):
        payload = fixture("codex_wham_usage.json")
        snapshot = self._fetch(payload)
        self.assertEqual(snapshot.plan_name, "pro")
        self.assertEqual(snapshot.identity, payload["email"])
        self.assertEqual(len(snapshot.windows), 2)
        primary, credits = snapshot.windows
        self.assertEqual(primary.name, "primary (7d)")
        self.assertEqual(primary.used, 91.0)
        self.assertEqual(primary.limit, 100.0)
        self.assertEqual(primary.resets_at, datetime.fromtimestamp(1791104309, tz=timezone.utc))
        self.assertEqual(credits.name, "credits")
        self.assertEqual(credits.limit, 0.0)
        self.assertEqual(snapshot.note, "reset credits: 0")

    # regression: live payload has secondary_window: null — crashed with AttributeError
    def test_null_windows_are_skipped(self):
        payload = fixture("codex_wham_usage.json")
        payload["rate_limit"]["primary_window"] = None
        payload["rate_limit"]["secondary_window"] = None
        snapshot = self._fetch(payload)
        self.assertEqual([window.name for window in snapshot.windows], ["credits"])

    def test_no_quota_data_raises(self):
        with self.assertRaises(QuotaFetchError):
            self._fetch({"plan_type": "pro"})

    def test_limit_reached_marks_primary_exhausted(self):
        payload = fixture("codex_wham_usage.json")
        payload["rate_limit"]["limit_reached"] = True
        snapshot = self._fetch(payload)
        self.assertIs(snapshot.windows[0].exhausted, True)

    def test_auth_rejection_is_a_fetch_error(self):
        transport = ScriptedTransport(
            {("GET", "https://chatgpt.com/backend-api/wham/usage"): json_response(401, {"detail": "expired"})}
        )
        with self.assertRaises(QuotaFetchError):
            CodexQuota().fetch(OAUTH, transport)

    def test_transport_failure_propagates(self):
        transport = ScriptedTransport(
            {("GET", "https://chatgpt.com/backend-api/wham/usage"): TransportError("offline")}
        )
        with self.assertRaises(TransportError):
            CodexQuota().fetch(OAUTH, transport)


class CopilotAdapterTests(unittest.TestCase):
    def _fetch(self, payload: object):
        transport = ScriptedTransport({("GET", "https://api.github.com/copilot_internal/user"): json_response(200, payload)})
        return CopilotQuota().fetch(OAUTH, transport)

    def test_parses_observed_schema(self):
        payload = fixture("copilot_user.json")
        snapshot = self._fetch(payload)
        self.assertEqual(snapshot.plan_name, "individual")
        self.assertEqual(snapshot.identity, payload["login"])
        self.assertEqual(snapshot.note, "free_engaged_oss_quota")
        windows = {window.name: window for window in snapshot.windows}
        premium = windows["premium requests"]
        self.assertEqual(premium.used, 1350.0)  # entitlement - remaining
        self.assertEqual(premium.limit, 1500.0)
        self.assertEqual(premium.resets_at, datetime(2026, 10, 1, tzinfo=timezone.utc))
        self.assertTrue(windows["chat"].unlimited)
        self.assertTrue(windows["completions"].unlimited)

    def test_quota_reset_at_overrides_body_date(self):
        payload = fixture("copilot_user.json")
        payload["quota_snapshots"]["premium_interactions"]["quota_reset_at"] = 1791104309
        windows = {window.name: window for window in self._fetch(payload).windows}
        self.assertEqual(
            windows["premium requests"].resets_at, datetime.fromtimestamp(1791104309, tz=timezone.utc)
        )

    def test_uses_refresh_token_for_auth(self):
        transport = ScriptedTransport(
            {("GET", "https://api.github.com/copilot_internal/user"): json_response(200, fixture("copilot_user.json"))}
        )
        CopilotQuota().fetch(OAUTH, transport)
        self.assertEqual(transport.calls, [("GET", "https://api.github.com/copilot_internal/user")])


class ZaiAdapterTests(unittest.TestCase):
    def test_account_without_plan_is_a_note(self):
        transport = ScriptedTransport(
            {("GET", "https://api.z.ai/api/monitor/usage/quota/limit"): json_response(200, fixture("zai_no_coding_plan.json"))}
        )
        snapshot = ZaiQuota().fetch(API_KEY, transport)
        self.assertEqual(snapshot.windows, ())
        self.assertEqual(snapshot.note, "当前用户不存在coding plan")

    def test_parses_limits_list(self):
        transport = ScriptedTransport(
            {("GET", "https://api.z.ai/api/monitor/usage/quota/limit"): json_response(200, fixture("zai_limits.json"))}
        )
        snapshot = ZaiQuota().fetch(API_KEY, transport)
        windows = {window.name: window for window in snapshot.windows}
        tokens = windows["tokens (5h)"]
        self.assertEqual((tokens.used, tokens.limit, tokens.unit), (12500000.0, 40000000.0, "tokens"))
        self.assertEqual(windows["MCP (1mo)"].unit, "calls")

    def test_sends_bare_authorization_token(self):
        transport = ScriptedTransport(
            {("GET", "https://api.z.ai/api/monitor/usage/quota/limit"): json_response(200, fixture("zai_no_coding_plan.json"))}
        )
        ZaiQuota().fetch(API_KEY, transport)
        self.assertEqual(len(transport.calls), 1)


class MinimaxAdapterTests(unittest.TestCase):
    def test_null_model_remains_is_a_note(self):
        transport = ScriptedTransport(
            {("GET", "https://api.minimax.io/v1/token_plan/remains"): json_response(200, fixture("minimax_remains_null.json"))}
        )
        snapshot = MinimaxQuota().fetch(OAUTH, transport)
        self.assertEqual(snapshot.windows, ())
        self.assertEqual(snapshot.note, "no active token plan")


class OpenRouterAdapterTests(unittest.TestCase):
    def test_parses_credits_and_rate_limit(self):
        transport = ScriptedTransport(
            {("GET", "https://openrouter.ai/api/v1/auth/key"): json_response(200, fixture("openrouter_auth_key.json"))}
        )
        snapshot = OpenRouterQuota().fetch(API_KEY, transport)
        self.assertEqual(snapshot.identity, "test key")
        windows = {window.name: window for window in snapshot.windows}
        self.assertEqual((windows["credits"].used, windows["credits"].limit), (1.25, 10.0))
        self.assertEqual((windows["requests/10s"].used, windows["requests/10s"].limit), (3.0, 20.0))

    def test_limit_reset_epoch_becomes_credits_reset(self):
        payload = fixture("openrouter_auth_key.json")
        payload["data"]["limit_reset"] = 1791104309
        transport = ScriptedTransport(
            {("GET", "https://openrouter.ai/api/v1/auth/key"): json_response(200, payload)}
        )
        windows = {window.name: window for window in OpenRouterQuota().fetch(API_KEY, transport).windows}
        self.assertEqual(windows["credits"].resets_at, datetime.fromtimestamp(1791104309, tz=timezone.utc))

    def test_limit_reset_iso_string_becomes_credits_reset(self):
        payload = fixture("openrouter_auth_key.json")
        payload["data"]["limit_reset"] = "2026-10-01T00:00:00Z"
        transport = ScriptedTransport(
            {("GET", "https://openrouter.ai/api/v1/auth/key"): json_response(200, payload)}
        )
        windows = {window.name: window for window in OpenRouterQuota().fetch(API_KEY, transport).windows}
        self.assertEqual(windows["credits"].resets_at, datetime(2026, 10, 1, tzinfo=timezone.utc))


class KimiAdapterTests(unittest.TestCase):
    def test_error_envelope_without_list_raises(self):
        transport = ScriptedTransport(
            {("GET", "https://api.kimi.com/coding/v1/usages"): json_response(200, {"usages": []})}
        )
        with self.assertRaises(QuotaFetchError):
            KimiQuota().fetch(OAUTH, transport)


if __name__ == "__main__":
    unittest.main()
