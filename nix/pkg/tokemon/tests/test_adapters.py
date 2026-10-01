"""Adapter tests over a scripted dummy Transport (BA).

Fixture origins:
- codex_wham_usage.json, claude_oauth_usage.json, claude_oauth_profile.json,
  copilot_user.json, zai_no_coding_plan.json,
  minimax_remains_null.json — sanitized live responses (2026-09-29).
- grok_billing_unified_live.json — live response of a unified-billing
  subscription (2026-10-01, history removed).
- zai_limits.json, openrouter_auth_key.json — synthetic payloads built from the
  documented / official-source response shapes.
- grok_billing_credits.json, grok_billing_legacy.json — synthetic payloads built
  from the Grok CLI's BillingConfig serde model and its own test payloads
  (xai-org/grok-build, extensions/billing.rs).
- xai_api_key.json, xai_management_key_validation.json, xai_prepaid_balance.json
  — the example responses of the xAI REST API reference (docs.x.ai).
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
from tokemon.adapters.xai import XaiManagementQuota, XaiQuota
from tokemon.adapters.zai import ZaiQuota
from tokemon.credentials import Credential, CredentialKind
from tokemon.quota import QuotaFetchError
from tokemon.transport import TransportError

FIXTURES = pathlib.Path(__file__).parent / "fixtures"

API_KEY = Credential(
    kind=CredentialKind.API_KEY, secret="test-key", refresh_token=None, account_id=None, expires_at=None, stores=()
)
OAUTH = Credential(
    kind=CredentialKind.OAUTH,
    secret="test-access",
    refresh_token="test-refresh",
    account_id="test-account",
    expires_at=None,
    stores=(),
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
        self.assertEqual(credits.unit, "credits")  # OpenAI credits, not a currency
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


class XaiSubscriptionAdapterTests(unittest.TestCase):
    BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"

    def _fetch(self, payload: object):
        transport = ScriptedTransport({("GET", self.BILLING_URL): json_response(200, payload)})
        return XaiQuota().fetch(OAUTH, transport), transport

    def test_parses_credits_config(self):
        snapshot, _ = self._fetch(fixture("grok_billing_credits.json"))
        self.assertEqual(
            [(w.name, w.used, w.limit, w.unit) for w in snapshot.windows],
            [
                ("weekly", 42.5, 100.0, "%"),
                ("on-demand", 1.25, 5.0, "USD"),
                ("prepaid", None, 86.66, "USD"),
            ],
        )
        self.assertEqual(snapshot.windows[0].resets_at, datetime(2026, 10, 5, 10, 13, 12, tzinfo=timezone.utc))

    def test_parses_observed_unified_billing_schema(self):
        snapshot, _ = self._fetch(fixture("grok_billing_unified_live.json"))
        self.assertEqual(
            [(w.name, w.used, w.limit, w.unit) for w in snapshot.windows],
            [("weekly", 0.0, 100.0, "%"), ("prepaid", None, 0.0, "USD")],
        )
        self.assertEqual(
            snapshot.windows[0].resets_at, datetime(2026, 10, 6, 17, 10, 14, 416436, tzinfo=timezone.utc)
        )

    def test_sends_grok_cli_token_marker(self):
        _, transport = self._fetch(fixture("grok_billing_credits.json"))
        self.assertEqual(transport.calls, [("GET", self.BILLING_URL)])
        self.assertEqual(transport.headers[0]["Authorization"], "Bearer test-access")
        self.assertEqual(transport.headers[0]["X-XAI-Token-Auth"], "xai-grok-cli")

    # proto3 JSON omits zero-valued scalars: an untouched pool has no creditUsagePercent
    def test_omitted_usage_percent_in_a_current_period_is_zero(self):
        payload = fixture("grok_billing_credits.json")
        del payload["config"]["creditUsagePercent"]
        snapshot, _ = self._fetch(payload)
        self.assertEqual((snapshot.windows[0].name, snapshot.windows[0].used), ("weekly", 0.0))

    # regression: billing stores bought credits as negative cents — the row was dropped
    def test_negative_prepaid_ledger_is_a_positive_balance(self):
        payload = fixture("grok_billing_credits.json")
        payload["config"]["prepaidBalance"] = {"val": -500}
        snapshot, _ = self._fetch(payload)
        prepaid = {w.name: w for w in snapshot.windows}["prepaid"]
        self.assertEqual((prepaid.used, prepaid.limit, prepaid.unit), (None, 5.0, "USD"))

    def test_zero_on_demand_cap_and_absent_prepaid_are_omitted(self):
        payload = fixture("grok_billing_credits.json")
        del payload["config"]["prepaidBalance"]
        payload["config"]["onDemandCap"] = {}
        snapshot, _ = self._fetch(payload)
        self.assertEqual([w.name for w in snapshot.windows], ["weekly"])

    def test_legacy_shape_falls_back_to_monthly_credits(self):
        snapshot, _ = self._fetch(fixture("grok_billing_legacy.json"))
        self.assertEqual(
            [(w.name, w.used, w.limit, w.unit) for w in snapshot.windows],
            [("monthly credits", 12.34, 20.0, "USD")],
        )
        self.assertEqual(snapshot.windows[0].resets_at, datetime(2026, 10, 1, tzinfo=timezone.utc))

    def test_account_without_billing_config_is_a_note(self):
        snapshot, _ = self._fetch({})
        self.assertEqual(snapshot.windows, ())
        self.assertIn("no Grok subscription", snapshot.note)

    def test_unrecognized_config_raises(self):
        with self.assertRaises(QuotaFetchError):
            self._fetch({"config": {"history": []}})

    def test_rejected_token_raises(self):
        transport = ScriptedTransport({("GET", self.BILLING_URL): json_response(401, {"error": "expired"})})
        with self.assertRaises(QuotaFetchError):
            XaiQuota().fetch(OAUTH, transport)


class XaiApiKeyAdapterTests(unittest.TestCase):
    API_KEY_URL = "https://api.x.ai/v1/api-key"

    def _fetch(self, payload: object):
        transport = ScriptedTransport({("GET", self.API_KEY_URL): json_response(200, payload)})
        return XaiQuota().fetch(API_KEY, transport)

    def test_inference_key_reports_identity_and_no_quota_note(self):
        snapshot = self._fetch(fixture("xai_api_key.json"))
        self.assertEqual(snapshot.identity, "My API Key")
        self.assertEqual(snapshot.windows, ())
        self.assertIn("XAI_MANAGEMENT_API_KEY", snapshot.note)

    def test_blocked_flags_are_reported(self):
        payload = fixture("xai_api_key.json")
        payload["team_blocked"] = True
        payload["api_key_disabled"] = True
        note = self._fetch(payload).note
        self.assertIn("team blocked", note)
        self.assertIn("key disabled", note)
        self.assertNotIn("key blocked", note)


class XaiManagementAdapterTests(unittest.TestCase):
    VALIDATION_URL = "https://management-api.x.ai/auth/management-keys/validation"
    BALANCE_URL = (
        "https://management-api.x.ai/v1/billing/teams/65c1e471-205f-4566-9c5a-07198badf4ce/prepaid/balance"
    )

    def _fetch(self, validation: object, balance: object):
        transport = ScriptedTransport(
            {
                ("GET", self.VALIDATION_URL): json_response(200, validation),
                ("GET", self.BALANCE_URL): json_response(200, balance),
            }
        )
        return XaiManagementQuota().fetch(API_KEY, transport)

    # the ledger is inverted: a $10 top-up is reported as "-1000" cents
    def test_prepaid_balance_is_the_negated_ledger_total(self):
        snapshot = self._fetch(fixture("xai_management_key_validation.json"), fixture("xai_prepaid_balance.json"))
        self.assertEqual(snapshot.identity, "test key")
        self.assertEqual(
            [(w.name, w.used, w.limit, w.unit) for w in snapshot.windows], [("prepaid", None, 10.0, "USD")]
        )

    def test_balance_without_total_raises(self):
        with self.assertRaises(QuotaFetchError):
            self._fetch(fixture("xai_management_key_validation.json"), {"changes": []})

    def test_key_without_team_scope_raises(self):
        validation = fixture("xai_management_key_validation.json")
        del validation["teamId"]
        validation["scope"] = "SCOPE_ORGANIZATION"
        with self.assertRaises(QuotaFetchError):
            self._fetch(validation, fixture("xai_prepaid_balance.json"))


class KimiAdapterTests(unittest.TestCase):
    def test_error_envelope_without_list_raises(self):
        transport = ScriptedTransport(
            {("GET", "https://api.kimi.com/coding/v1/usages"): json_response(200, {"usages": []})}
        )
        with self.assertRaises(QuotaFetchError):
            KimiQuota().fetch(OAUTH, transport)


if __name__ == "__main__":
    unittest.main()
