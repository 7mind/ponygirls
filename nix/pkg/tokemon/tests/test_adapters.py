"""Adapter tests over a scripted dummy Transport (BA).

Fixture origins:
- codex_wham_usage.json, claude_oauth_usage.json, claude_oauth_profile.json,
  copilot_user.json, zai_no_coding_plan.json,
  minimax_remains_null.json — sanitized live responses (2026-09-29).
- openrouter_key.json, vercel_credits.json — sanitized live responses (2026-10-01).
- grok_billing_unified_live.json — live response of a unified-billing
  subscription (2026-10-01, history removed).
- kimi_usages.json — synthetic payload built from the response handling of
  kimi-cli's own /usage command (MoonshotAI/kimi-cli, ui/shell/usage.py).
- kimi_usages_ratio.json — live /usages response (2026-10-02); month_code ratio
  edited from 0 to 0.18 so the percent scaling is observable.
- minimax_remains_plan.json, zai_limits.json — synthetic payloads built from the
  field handling of CodexBar's MiniMax and z.ai parsers (steipete/CodexBar);
  the z.ai limit types also match the official zai-coding-plugins script.
- meta_muse_key.json — synthetic payload built from the @ikuma.cloud/pix-usage
  pi extension's Muse quota parsing and pi's own Meta key-mint flow (pi-ai
  auth/oauth/meta.ts); the stored identity token on this host had expired, so
  no live response could be captured.
- grok_billing_credits.json, grok_billing_legacy.json — synthetic payloads built
  from the Grok CLI's BillingConfig serde model and its own test payloads
  (xai-org/grok-build, extensions/billing.rs).
- xai_user_team.json — synthetic payload built from the Grok CLI's UserInfo model
  (xai-grok-login model.rs), with the team fields of a live SuperGrok Business
  account (2026-10-01); identifiers are made up.
- xai_invoice_preview.json — live response of a team on included credits
  (2026-10-01), invoice lines trimmed.
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
from tokemon.adapters.meta import MUSE_KEY_URL, MetaQuota
from tokemon.adapters.minimax import MinimaxQuota
from tokemon.adapters.openrouter import OpenRouterQuota
from tokemon.adapters.vercel import VercelGatewayQuota
from tokemon.adapters.xai import XaiManagementQuota, XaiQuota
from tokemon.adapters.zai import ZaiQuota
from tokemon.credentials import Credential, CredentialKind
from tokemon.quota import QuotaFetchError, RateLimitedError
from tokemon.transport import HttpResponse, TransportError

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
META_OAUTH = Credential(
    kind=CredentialKind.OAUTH,
    secret="LLM|muse|test-inference-key",
    refresh_token="dca:test-identity",
    account_id=None,
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

    def test_enabled_extra_usage_is_a_spend_row_in_the_account_currency(self):
        usage = fixture("claude_oauth_usage.json")
        usage["spend"].update(
            {
                "enabled": True,
                "used": {"amount_minor": 1234, "currency": "EUR", "exponent": 2},
                "limit": {"amount_minor": 20000, "currency": "EUR", "exponent": 2},
            }
        )
        snapshot, _ = self._fetch(usage, fixture("claude_oauth_profile.json"))
        extra = snapshot.windows[-1]
        self.assertEqual((extra.name, extra.used, extra.limit, extra.unit), ("extra usage", 12.34, 200.0, "EUR"))
        self.assertIsNone(snapshot.note)

    def test_blocked_extra_for_any_reason_is_silent(self):
        for reason in ("out_of_credits", "admin_disabled"):
            with self.subTest(reason=reason):
                usage = fixture("claude_oauth_usage.json")
                usage["spend"].update({"enabled": False, "disabled_reason": reason})
                snapshot, _ = self._fetch(usage, fixture("claude_oauth_profile.json"))
                self.assertEqual(len(snapshot.windows), 3)
                self.assertIsNone(snapshot.note)

    def test_extra_usage_never_enabled_is_silent(self):
        snapshot, _ = self._fetch(fixture("claude_oauth_usage.json"), fixture("claude_oauth_profile.json"))
        self.assertIsNone(snapshot.note)

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
        self.assertEqual(snapshot.note, "resets: 0")

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

    # observed live 2026-10-01: a separate ChatPass quota, absent from the Codex CLI's model
    def test_chatpass_windows_are_shown(self):
        payload = fixture("codex_wham_usage.json")
        payload["chatpass"] = {
            "windows": [{"used_percent": 7, "limit_window_seconds": 604800, "reset_after_seconds": 604800, "reset_at": 1791458686}]
        }
        windows = {window.name: window for window in self._fetch(payload).windows}
        self.assertEqual(windows["chatpass (7d)"].used, 7.0)
        self.assertEqual(windows["chatpass (7d)"].resets_at, datetime.fromtimestamp(1791458686, tz=timezone.utc))

    # regression: the code-review limit is a rate-limit status, not a bare window, and was dropped
    def test_code_review_limit_is_a_rate_limit_status(self):
        payload = fixture("codex_wham_usage.json")
        payload["code_review_rate_limit"] = {
            "allowed": True,
            "limit_reached": False,
            "primary_window": {"used_percent": 33, "limit_window_seconds": 604800, "reset_at": 1791104309},
            "secondary_window": None,
        }
        windows = {window.name: window for window in self._fetch(payload).windows}
        self.assertEqual(windows["code review (7d)"].used, 33.0)

    # regression: additional_rate_limits is a list of named rate-limit statuses
    # (openai/codex AdditionalRateLimitDetails); it was read as a dict and dropped
    def test_additional_rate_limits_list_is_shown(self):
        payload = fixture("codex_wham_usage.json")
        payload["additional_rate_limits"] = [
            {
                "limit_name": "codex_other",
                "metered_feature": "codex_other",
                "rate_limit": {
                    "allowed": True,
                    "limit_reached": True,
                    "primary_window": {"used_percent": 100, "limit_window_seconds": 900, "reset_at": 1791104309},
                    "secondary_window": {"used_percent": 84, "limit_window_seconds": 3600, "reset_at": 1791104309},
                },
            },
            {"limit_name": "unprovisioned", "metered_feature": "x", "rate_limit": None},
        ]
        windows = {window.name: window for window in self._fetch(payload).windows}
        self.assertEqual(windows["codex_other (15m)"].used, 100.0)
        self.assertIs(windows["codex_other (15m)"].exhausted, True)
        self.assertEqual(windows["codex_other (1h)"].used, 84.0)
        self.assertNotIn("unprovisioned", " ".join(windows))

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
        premium = windows["AI credits"]  # the live account is on token-based billing
        self.assertEqual(premium.used, 1350.0)  # entitlement - remaining
        self.assertEqual(premium.limit, 1500.0)
        self.assertEqual(premium.unit, "credits")
        self.assertEqual(premium.resets_at, datetime(2026, 10, 1, tzinfo=timezone.utc))
        self.assertTrue(windows["chat"].unlimited)
        self.assertTrue(windows["completions"].unlimited)

    def test_request_based_billing_keeps_premium_requests(self):
        payload = fixture("copilot_user.json")
        payload["quota_snapshots"]["premium_interactions"]["token_based_billing"] = False
        windows = {window.name: window for window in self._fetch(payload).windows}
        self.assertEqual(windows["premium requests"].unit, "requests")

    def test_quota_reset_at_overrides_body_date(self):
        payload = fixture("copilot_user.json")
        payload["quota_snapshots"]["premium_interactions"]["quota_reset_at"] = 1791104309
        windows = {window.name: window for window in self._fetch(payload).windows}
        self.assertEqual(
            windows["AI credits"].resets_at, datetime.fromtimestamp(1791104309, tz=timezone.utc)
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
        self.assertEqual(tokens.resets_at, datetime.fromtimestamp(1790866800, tz=timezone.utc))
        # regression: the weekly token limit was labelled "tokens (5h)" and overwrote the 5h one
        weekly = windows["tokens (7d)"]
        self.assertEqual((weekly.used, weekly.limit, weekly.unit), (12.0, 100.0, "%"))
        self.assertEqual(windows["MCP (1mo)"].unit, "calls")
        self.assertEqual(len(snapshot.windows), 3)
        self.assertIsNone(snapshot.plan_name)

    def test_plan_level_is_shown_and_login_is_absent(self):
        payload = fixture("zai_limits.json")
        payload["data"]["level"] = "lite"
        transport = ScriptedTransport(
            {("GET", "https://api.z.ai/api/monitor/usage/quota/limit"): json_response(200, payload)}
        )
        snapshot = ZaiQuota().fetch(API_KEY, transport)
        self.assertEqual((snapshot.plan_name, snapshot.identity), ("lite", None))

    def test_used_is_derived_from_remaining_and_credit_limits_are_named(self):
        payload = fixture("zai_limits.json")
        entry = payload["data"]["limits"][0]
        del entry["currentValue"]
        entry["type"] = "CREDIT_LIMIT"
        transport = ScriptedTransport(
            {("GET", "https://api.z.ai/api/monitor/usage/quota/limit"): json_response(200, payload)}
        )
        window = ZaiQuota().fetch(API_KEY, transport).windows[0]
        self.assertEqual((window.name, window.used, window.limit, window.unit), ("credits (5h)", 12500000.0, 40000000.0, "credits"))

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

    # regression: plan entries carry current_interval_* counts, where "usage_count"
    # is the REMAINING quota; the adapter looked for used/limit and raised
    def test_parses_plan_entries_with_remaining_counts(self):
        transport = ScriptedTransport(
            {("GET", "https://api.minimax.io/v1/token_plan/remains"): json_response(200, fixture("minimax_remains_plan.json"))}
        )
        snapshot = MinimaxQuota().fetch(OAUTH, transport)
        self.assertEqual(
            [(w.name, w.used, w.limit, w.unit) for w in snapshot.windows],
            [("MiniMax-M2 (5h)", 500.0, 4500.0, "requests"), ("MiniMax-M2 (7d)", 15000.0, 45000.0, "requests")],
        )
        self.assertEqual(snapshot.windows[0].resets_at, datetime.fromtimestamp(1790866800, tz=timezone.utc))
        self.assertEqual(snapshot.windows[1].resets_at, datetime.fromtimestamp(1791158400, tz=timezone.utc))

    def test_percent_only_lane_is_shown_as_percent(self):
        payload = fixture("minimax_remains_plan.json")
        lane = payload["model_remains"][1]
        lane["current_interval_status"] = 1
        lane["current_interval_remaining_percent"] = 75
        transport = ScriptedTransport(
            {("GET", "https://api.minimax.io/v1/token_plan/remains"): json_response(200, payload)}
        )
        windows = {w.name: w for w in MinimaxQuota().fetch(OAUTH, transport).windows}
        self.assertEqual((windows["video (5h)"].used, windows["video (5h)"].limit, windows["video (5h)"].unit), (25.0, 100.0, "%"))


class OpenRouterAdapterTests(unittest.TestCase):
    KEY_URL = "https://openrouter.ai/api/v1/key"
    CREDITS_URL = "https://openrouter.ai/api/v1/credits"
    CREDITS = {"data": {"total_credits": 25, "total_usage": 3.5}}

    def _fetch(self, key: object, credits: object):
        transport = ScriptedTransport({("GET", self.KEY_URL): json_response(200, key), ("GET", self.CREDITS_URL): credits})
        return OpenRouterQuota().fetch(API_KEY, transport)

    # regression: the "credits" row was the key's lifetime spend, not the account balance
    def test_credits_row_is_the_account_balance(self):
        snapshot = self._fetch(fixture("openrouter_key.json"), json_response(200, self.CREDITS))
        self.assertEqual(snapshot.identity, "sk-or-v1-abc...123")
        self.assertEqual(
            [(w.name, w.used, w.limit, w.unit) for w in snapshot.windows],
            [("credits", 3.5, 25.0, "USD"), ("free models (1d)", 0.0, 50.0, "requests")],
        )
        self.assertIsNone(snapshot.note)

    def test_key_spending_limit_is_its_own_row(self):
        key = fixture("openrouter_key.json")
        key["data"].update({"limit": 10.0, "usage": 1.25, "limit_remaining": 8.75, "limit_reset": "monthly"})
        windows = {w.name: w for w in self._fetch(key, json_response(200, self.CREDITS)).windows}
        limit = windows["key limit (monthly)"]
        self.assertEqual((limit.used, limit.limit, limit.unit), (1.25, 10.0, "USD"))

    # the docs reserve /credits for management keys; a refusal must not hide the key's own limits
    def test_refused_credits_are_noted_and_key_rows_kept(self):
        snapshot = self._fetch(fixture("openrouter_key.json"), json_response(403, {"error": {"code": 403}}))
        self.assertEqual([w.name for w in snapshot.windows], ["free models (1d)"])
        self.assertIn("account credits unavailable", snapshot.note)

    def test_deprecated_rate_limit_is_ignored(self):
        names = [w.name for w in self._fetch(fixture("openrouter_key.json"), json_response(200, self.CREDITS)).windows]
        self.assertFalse([name for name in names if name.startswith("requests")])


class VercelGatewayAdapterTests(unittest.TestCase):
    CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits"

    def _fetch(self, payload: object):
        transport = ScriptedTransport({("GET", self.CREDITS_URL): json_response(200, payload)})
        return VercelGatewayQuota().fetch(API_KEY, transport)

    def test_parses_observed_schema(self):
        snapshot = self._fetch(fixture("vercel_credits.json"))
        self.assertEqual([(w.name, w.used, w.limit, w.unit) for w in snapshot.windows], [("credits", 0.0, 0.0, "USD")])

    def test_spend_is_shown_against_spend_plus_balance(self):
        (window,) = self._fetch({"balance": "21.50", "total_used": "3.50"}).windows
        self.assertEqual((window.used, window.limit), (3.5, 25.0))

    def test_missing_balance_raises(self):
        with self.assertRaises(QuotaFetchError):
            self._fetch({"total_used": "3.50"})


class XaiSubscriptionAdapterTests(unittest.TestCase):
    USER_URL = "https://cli-chat-proxy.grok.com/v1/user?include=subscription"
    BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"
    PERSONAL_USER = {"userId": "u-1", "email": "user@example.test", "subscriptionTier": "SuperGrok"}

    def _fetch(self, payload: object, user: object = PERSONAL_USER):
        transport = ScriptedTransport(
            {("GET", self.USER_URL): json_response(200, user), ("GET", self.BILLING_URL): json_response(200, payload)}
        )
        return XaiQuota().fetch(OAUTH, transport), transport

    # regression: a team seat is billed per token to its team's credits on every route;
    # the consumer pool it never touches was shown as a permanent "weekly 0%"
    def test_team_seat_points_to_team_credits_instead_of_the_consumer_pool(self):
        snapshot, transport = self._fetch(fixture("grok_billing_unified_live.json"), fixture("xai_user_team.json"))
        self.assertEqual(snapshot.windows, ())
        self.assertIn("team's credits", snapshot.note)
        self.assertIn("XAI_MANAGEMENT_API_KEY", snapshot.note)
        self.assertEqual((snapshot.identity, snapshot.plan_name), ("user@example.test", "GrokPro"))
        self.assertEqual(transport.calls, [("GET", self.USER_URL)])  # the consumer pool is not asked for

    def test_personal_account_has_no_team_note(self):
        snapshot, _ = self._fetch(fixture("grok_billing_unified_live.json"))
        self.assertIsNone(snapshot.note)

    def test_personal_account_reports_login_and_plan(self):
        snapshot, _ = self._fetch(fixture("grok_billing_credits.json"))
        self.assertEqual((snapshot.identity, snapshot.plan_name), ("user@example.test", "SuperGrok"))

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
        self.assertEqual(transport.calls, [("GET", self.USER_URL), ("GET", self.BILLING_URL)])
        for headers in transport.headers:
            self.assertEqual(headers["Authorization"], "Bearer test-access")
            self.assertEqual(headers["X-XAI-Token-Auth"], "xai-grok-cli")

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
        transport = ScriptedTransport({("GET", self.USER_URL): json_response(401, {"error": "expired"})})
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

    PREVIEW_URL = (
        "https://management-api.x.ai/v1/billing/teams/65c1e471-205f-4566-9c5a-07198badf4ce/postpaid/invoice/preview"
    )
    EMPTY_BALANCE = {"changes": [], "total": {"val": "0"}}

    def _fetch(self, validation: object, balance: object, preview: object = None):
        preview = fixture("xai_invoice_preview.json") if preview is None else preview
        transport = ScriptedTransport(
            {
                ("GET", self.VALIDATION_URL): json_response(200, validation),
                ("GET", self.BALANCE_URL): json_response(200, balance),
                ("GET", self.PREVIEW_URL): json_response(200, preview),
            }
        )
        return XaiManagementQuota().fetch(API_KEY, transport)

    # regression: a team on included credits has an empty prepaid ledger; its usage and
    # credits are in the invoice preview, and the only row was "prepaid $-0.00"
    def test_cycle_usage_is_shown_against_the_included_credits(self):
        snapshot = self._fetch(fixture("xai_management_key_validation.json"), self.EMPTY_BALANCE)
        self.assertEqual(
            [(w.name, w.used, w.limit, w.unit) for w in snapshot.windows],
            [("credits (1mo)", 1.18, 148.19, "USD"), ("prepaid", None, 0.0, "USD")],
        )
        self.assertEqual(snapshot.windows[0].resets_at, datetime(2026, 11, 1, tzinfo=timezone.utc))
        self.assertEqual(str(snapshot.windows[1].limit), "0.0")  # not the negative zero that rendered as $-0.00

    def test_december_cycle_resets_in_january(self):
        preview = fixture("xai_invoice_preview.json")
        preview["billingCycle"] = {"year": 2026, "month": 12}
        window = self._fetch(fixture("xai_management_key_validation.json"), self.EMPTY_BALANCE, preview).windows[0]
        self.assertEqual(window.resets_at, datetime(2027, 1, 1, tzinfo=timezone.utc))

    def test_usage_without_included_credits_has_no_limit(self):
        preview = fixture("xai_invoice_preview.json")
        preview["defaultCredits"] = "0"
        window = self._fetch(fixture("xai_management_key_validation.json"), self.EMPTY_BALANCE, preview).windows[0]
        self.assertEqual((window.used, window.limit), (1.18, None))

    # the ledger is inverted: a $10 top-up is reported as "-1000" cents
    def test_prepaid_balance_is_the_negated_ledger_total(self):
        snapshot = self._fetch(fixture("xai_management_key_validation.json"), fixture("xai_prepaid_balance.json"))
        self.assertEqual(snapshot.identity, "test key")
        prepaid = snapshot.windows[-1]
        self.assertEqual((prepaid.name, prepaid.used, prepaid.limit, prepaid.unit), ("prepaid", None, 10.0, "USD"))

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
    USAGES_URL = "https://api.kimi.com/coding/v1/usages"

    def _fetch(self, payload: object):
        return KimiQuota().fetch(OAUTH, ScriptedTransport({("GET", self.USAGES_URL): json_response(200, payload)}))

    # regression: the adapter expected a data/usages list and rejected the real shape
    def test_parses_usage_summary_and_windowed_limits(self):
        snapshot = self._fetch(fixture("kimi_usages.json"))
        self.assertEqual(
            [(w.name, w.used, w.limit) for w in snapshot.windows],
            [("weekly", 37.0, 100.0), ("limit (5h)", 12.0, 100.0)],  # second: used = limit - remaining
        )
        self.assertEqual(
            snapshot.windows[0].resets_at, datetime(2026, 10, 5, 5, 24, 18, 443553, tzinfo=timezone.utc)
        )

    def test_ratio_usages_add_monthly_windows_without_duplicating_5h(self):
        snapshot = self._fetch(fixture("kimi_usages_ratio.json"))
        self.assertEqual(
            [(w.name, w.used, w.limit, w.unit) for w in snapshot.windows],
            [
                ("limit (5h)", 0.0, 100.0, "units"),
                ("monthly (code)", 18.0, 100.0, "%"),
                ("monthly (membership)", 0.0, 100.0, "%"),
            ],
        )
        self.assertEqual(
            snapshot.windows[1].resets_at, datetime(2026, 11, 3, tzinfo=timezone.utc)
        )

    def test_ratio_only_payload_scales_fraction_and_accepts_camel_case(self):
        snapshot = self._fetch(
            {
                "usages": {
                    "limit_7d": {"used_ratio": "0.1", "reset_time": "2026-10-08T00:00:00Z"},
                    "monthCode": {"usedRatio": 0.18, "resetAt": "2026-11-03T00:00:00Z"},
                    "limit_custom": {"used_ratio": 0.5, "reset_time": "2026-12-01T00:00:00Z"},
                }
            }
        )
        self.assertEqual(
            [(w.name, w.used, w.unit) for w in snapshot.windows],
            [("weekly (7d)", 10.0, "%"), ("monthly (code)", 18.0, "%"), ("limit custom", 50.0, "%")],
        )

    def test_weekly_summary_suppresses_duplicate_7d_ratio(self):
        payload = fixture("kimi_usages.json")
        payload["usages"] = {
            "limit_7d": {"used_ratio": 0.99, "reset_time": "2026-10-05T05:24:18Z"},
            "limit_month_total": {"used_ratio": 0.25, "reset_time": "2026-11-01T00:00:00Z"},
        }
        snapshot = self._fetch(payload)
        self.assertEqual(
            [w.name for w in snapshot.windows], ["weekly", "limit (5h)", "monthly (membership)"]
        )
        self.assertEqual(snapshot.windows[-1].used, 25.0)

    def test_me_supplies_login_and_plan_and_a_missing_me_does_not_hide_usage(self):
        payload = fixture("kimi_usages.json")
        me = {"email": "user@example.test", "nickname": "Nick", "user_level_name": "Plus"}
        transport = ScriptedTransport(
            {
                ("GET", self.USAGES_URL): json_response(200, payload),
                ("GET", "https://api.kimi.com/coding/v1/me"): json_response(200, me),
            }
        )
        snapshot = KimiQuota().fetch(OAUTH, transport)
        self.assertEqual((snapshot.identity, snapshot.plan_name), ("user@example.test", "Plus"))

        usage_only = self._fetch(payload)
        self.assertIsNone(usage_only.identity)
        self.assertIsNone(usage_only.plan_name)
        self.assertTrue(usage_only.windows)

    def test_payload_without_usage_raises(self):
        with self.assertRaises(QuotaFetchError):
            self._fetch({"usages": []})


class MetaAdapterTests(unittest.TestCase):
    def _fetch(self, payload: object, credential: Credential = META_OAUTH, status: int = 200):
        transport = ScriptedTransport({("POST", MUSE_KEY_URL): json_response(status, payload)})
        return MetaQuota().fetch(credential, transport), transport

    def test_parses_subscription_windows(self):
        snapshot, transport = self._fetch(fixture("meta_muse_key.json"))
        self.assertEqual(
            [(w.name, w.used, w.limit, w.unit) for w in snapshot.windows],
            [("primary (5h)", 12.5, 100.0, "%"), ("weekly (7d)", 34.0, 100.0, "%")],
        )
        self.assertEqual(
            snapshot.windows[0].resets_at, datetime.fromtimestamp(1791144000, tz=timezone.utc)
        )
        self.assertEqual(
            snapshot.windows[1].resets_at, datetime.fromtimestamp(1791547200, tz=timezone.utc)
        )
        self.assertEqual(snapshot.identity, "user@example.test")
        self.assertEqual(snapshot.plan_name, "Muse Code High Usage")
        self.assertIsNone(snapshot.note)
        # the quota check is one key-mint POST against the identity token
        self.assertEqual(transport.calls, [("POST", MUSE_KEY_URL)])
        self.assertEqual(transport.headers[0]["Authorization"], "Bearer dca:test-identity")
        self.assertEqual(transport.headers[0]["x-api-version"], "1.0.0")
        self.assertEqual(transport.bodies[0], b"{}")

    def test_idle_subscription_without_subs_usage_returns_note(self):
        snapshot, _ = self._fetch({"is_subs_active": True})
        self.assertEqual(snapshot.windows, ())
        self.assertIsNotNone(snapshot.note)

    def test_login_falls_back_to_full_name_and_missing_tier_is_silent(self):
        payload = fixture("meta_muse_key.json")
        del payload["user_email"]
        del payload["subs_tier_name"]
        snapshot, _ = self._fetch(payload)
        self.assertEqual(snapshot.identity, "Test User")
        self.assertIsNone(snapshot.plan_name)
        self.assertTrue(snapshot.windows)

    def test_subs_usage_without_window_pair_raises(self):
        with self.assertRaises(QuotaFetchError):
            self._fetch({"is_subs_active": True, "subs_usage": {"window": {}}})

    def test_payment_required_raises(self):
        with self.assertRaises(QuotaFetchError):
            self._fetch({"require_payment": True, "is_subs_active": True})

    def test_inactive_subscription_raises(self):
        with self.assertRaises(QuotaFetchError):
            self._fetch({"is_subs_active": False})
        with self.assertRaises(QuotaFetchError):
            self._fetch({})

    def test_api_key_reports_note_without_network(self):
        snapshot, transport = self._fetch({}, API_KEY)
        self.assertEqual(transport.calls, [])
        self.assertEqual(snapshot.windows, ())
        self.assertIn("API key", snapshot.note)

    def test_non_device_identity_raises(self):
        # OAUTH carries refresh "test-refresh", not a dca: identity token
        with self.assertRaises(QuotaFetchError):
            self._fetch({}, OAUTH)

    def test_expired_session_raises(self):
        with self.assertRaises(QuotaFetchError):
            self._fetch({"title": "restricted"}, status=401)

    def test_rate_limited_raises_with_retry_after(self):
        transport = ScriptedTransport(
            {("POST", MUSE_KEY_URL): HttpResponse(status=429, body=b"{}", retry_after="60")}
        )
        with self.assertRaises(RateLimitedError):
            MetaQuota().fetch(META_OAUTH, transport)


if __name__ == "__main__":
    unittest.main()
