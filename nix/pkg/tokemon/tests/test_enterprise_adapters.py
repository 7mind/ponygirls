"""Specified own-account enterprise contracts (BA), synthetic fixtures, no network.

Codex monthly credits use the supplied openai/codex PR #24812 schema;
these fixtures are not observations of live enterprise responses.
"""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

import test_adapters
from test_adapters import fixture
from tokemon.quota import QuotaFetchError


class ClaudeEnterpriseTests(unittest.TestCase):
    def _fetch(self, usage):
        return test_adapters.ClaudeAdapterTests()._fetch(usage, fixture("claude_enterprise_profile.json"))[0]

    def test_spend_only_and_no_double_count(self):
        snapshot = self._fetch(fixture("claude_enterprise_usage.json"))
        self.assertEqual(snapshot.plan_name, "claude_enterprise")
        self.assertEqual(snapshot.identity, "member@example.test")
        self.assertIsNone(snapshot.note)
        self.assertEqual(len(snapshot.windows), 1)
        window = snapshot.windows[0]
        self.assertEqual((window.name, window.used, window.limit, window.unit), ("extra usage", 12.34, 200, "USD"))
        self.assertEqual(window.resets_at, datetime(2026, 10, 1, tzinfo=timezone.utc))

    def test_legacy_rolling_windows_only_when_modern_absent(self):
        usage = fixture("claude_enterprise_usage.json")
        observed = fixture("claude_oauth_usage.json")
        usage.update(
            five_hour=observed["five_hour"], seven_day=observed["seven_day"],
            seven_day_opus={"utilization": 31, "resets_at": "2026-10-01T00:00:00Z"},
            seven_day_sonnet={"utilization": 0, "resets_at": "2026-10-01T00:00:00Z"},
        )
        windows = self._fetch(usage).windows
        self.assertEqual([(w.name, w.used) for w in windows[:2]], [("session (5h)", 22), ("weekly (7d)", 18)])
        self.assertEqual(windows[0].resets_at, datetime.fromisoformat(observed["five_hour"]["resets_at"]))
        self.assertEqual([(w.name, w.used) for w in windows[2:4]], [("weekly (7d) Opus", 31), ("weekly (7d) Sonnet", 0)])
        self.assertEqual(windows[2].resets_at, datetime(2026, 10, 1, tzinfo=timezone.utc))
        usage["limits"] = observed["limits"]
        self.assertEqual(len(self._fetch(usage).windows), 4)

    def test_legacy_rolling_rejects_invalid_percent(self):
        for percent in (-1, True, "NaN", "Infinity", "bad", None):
            with self.subTest(percent=percent):
                usage = fixture("claude_enterprise_usage.json")
                for key in ("five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"):
                    usage[key] = {"utilization": percent}
                self.assertEqual([w.name for w in self._fetch(usage).windows], ["extra usage"])

    def test_modern_currency_mismatch_keeps_limit_unknown(self):
        usage = fixture("claude_enterprise_usage.json")
        usage["spend"]["limit"]["currency"] = "EUR"
        window = self._fetch(usage).windows[0]
        self.assertEqual((window.used, window.unit), (12.34, "USD"))
        self.assertIsNone(window.limit)

    def test_legacy_cents_and_reset(self):
        usage = fixture("claude_enterprise_usage.json")
        del usage["spend"]
        window = self._fetch(usage).windows[0]
        self.assertEqual((window.used, window.limit, window.unit), (12.34, 200, "USD"))
        self.assertEqual(window.resets_at, datetime(2026, 10, 1, tzinfo=timezone.utc))

    def test_legacy_fallback_when_modern_unavailable(self):
        usage = fixture("claude_enterprise_usage.json")
        usage["spend"]["enabled"] = False
        self.assertEqual(self._fetch(usage).windows[0].used, 12.34)

    def test_preserves_rolling_windows(self):
        usage = fixture("claude_enterprise_usage.json")
        usage["limits"] = fixture("claude_oauth_usage.json")["limits"]
        snapshot = self._fetch(usage)
        self.assertEqual(len(snapshot.windows), 4)
        self.assertEqual((snapshot.windows[0].name, snapshot.windows[0].used), ("session (5h)", 22))
        self.assertIsNotNone(snapshot.windows[0].resets_at)

    def test_zero_is_available_not_unlimited(self):
        for modern in (True, False):
            with self.subTest(modern=modern):
                usage = fixture("claude_enterprise_usage.json")
                if modern:
                    usage["spend"]["used"]["amount_minor"] = 0
                    usage["spend"]["limit"]["amount_minor"] = 0
                else:
                    del usage["spend"]
                    usage["extra_usage"].update(used_credits=0, monthly_limit=0)
                snapshot = self._fetch(usage)
                self.assertIsNone(snapshot.note)
                self.assertEqual((snapshot.windows[0].used, snapshot.windows[0].limit), (0, 0))
                self.assertFalse(snapshot.windows[0].unlimited)

    def test_missing_disabled_or_malformed_spend_has_explicit_note(self):
        for spend in (None, {}, {"enabled": False}, {"enabled": True, "used": {}},
                      {"enabled": True, "used": {"amount_minor": "NaN", "currency": "USD", "exponent": 2}}):
            for rolling in (False, True):
                with self.subTest(spend=spend, rolling=rolling):
                    usage = {"spend": spend}
                    if rolling:
                        usage["limits"] = fixture("claude_oauth_usage.json")["limits"]
                    snapshot = self._fetch(usage)
                    self.assertEqual(snapshot.note, "enterprise spend unavailable through OAuth")
                    self.assertEqual(len(snapshot.windows), 3 if rolling else 0)

    def test_legacy_missing_or_malformed_used_does_not_fabricate_zero(self):
        for used in (None, "bad", "Infinity", -1, True, 10**1000):
            with self.subTest(used=used):
                snapshot = self._fetch({"extra_usage": {"is_enabled": True, "used_credits": used, "monthly_limit": 20000}})
                self.assertEqual(snapshot.windows, ())
                self.assertEqual(snapshot.note, "enterprise spend unavailable through OAuth")

    def test_missing_limit_and_reset_stay_unknown(self):
        usage = fixture("claude_enterprise_usage.json")
        usage["spend"].update(limit=None, resets_at="invalid")
        window = self._fetch(usage).windows[0]
        self.assertIsNone(window.limit)
        self.assertIsNone(window.resets_at)
        self.assertFalse(window.unlimited)


class CodexEnterpriseTests(unittest.TestCase):
    def _fetch(self, usage):
        return test_adapters.CodexAdapterTests()._fetch(usage)

    # BA regression: availability is meaningful even when numeric quotas are undisclosed.
    def test_available_credits_without_balance(self):
        snapshot = self._fetch({
            "plan_type": "business", "rate_limit": None, "code_review_rate_limit": None,
            "additional_rate_limits": None,
            "credits": {"has_credits": True, "unlimited": False, "overage_limit_reached": False,
                        "balance": None, "approx_local_messages": None, "approx_cloud_messages": None},
            "spend_control": {"reached": False, "individual_limit": None},
        })
        self.assertEqual(snapshot.plan_name, "business")
        self.assertEqual(snapshot.windows, ())
        self.assertEqual(snapshot.note, "credits available (balance unavailable)")
        for has_credits in (None, "true", 1):
            with self.subTest(has_credits=has_credits), self.assertRaises(QuotaFetchError):
                self._fetch({"credits": {"has_credits": has_credits, "balance": None}})

    def test_monthly_credits_only(self):
        snapshot = self._fetch(fixture("codex_enterprise_usage.json"))
        self.assertEqual(snapshot.plan_name, "enterprise")
        self.assertEqual(len(snapshot.windows), 1)
        window = snapshot.windows[0]
        self.assertEqual((window.name, window.used, window.limit, window.unit), ("monthly credits", 8000, 25000, "credits"))
        self.assertEqual(window.resets_at, datetime.fromtimestamp(1778137680, tz=timezone.utc))
        self.assertFalse(window.unlimited)
        self.assertIsNot(window.exhausted, True)

    def test_balance_credits_and_rolling_remain_separate(self):
        usage = fixture("codex_enterprise_usage.json")
        observed = fixture("codex_wham_usage.json")
        usage.update(rate_limit=observed["rate_limit"], credits=observed["credits"])
        windows = {w.name: w for w in self._fetch(usage).windows}
        self.assertEqual(list(windows), ["primary (7d)", "monthly credits", "credits"])
        self.assertEqual(windows["credits"].limit, 0)
        self.assertEqual(windows["monthly credits"].limit, 25000)
        self.assertEqual(windows["primary (7d)"].used, 91)

    def test_spend_reached_marks_only_monthly_exhausted(self):
        usage = fixture("codex_enterprise_usage.json")
        usage["spend_control"]["reached"] = True
        usage["rate_limit"] = fixture("codex_wham_usage.json")["rate_limit"]
        windows = {w.name: w for w in self._fetch(usage).windows}
        self.assertIs(windows["monthly credits"].exhausted, True)
        self.assertIsNot(windows["primary (7d)"].exhausted, True)

    def test_used_only_keeps_limit_unknown(self):
        usage = fixture("codex_enterprise_usage.json")
        del usage["spend_control"]["individual_limit"]["limit"]
        window = self._fetch(usage).windows[0]
        self.assertEqual(window.used, 8000)
        self.assertIsNone(window.limit)
        self.assertFalse(window.unlimited)
        self.assertIsNone(window.exhausted)

    def test_zero_values_not_unlimited(self):
        usage = fixture("codex_enterprise_usage.json")
        usage["spend_control"]["individual_limit"].update(limit="0", used="0")
        window = self._fetch(usage).windows[0]
        self.assertEqual((window.used, window.limit), (0, 0))
        self.assertFalse(window.unlimited)

    def test_missing_or_invalid_monthly_data_does_not_fabricate_amounts(self):
        for monthly in (None, {}, {"limit": "25000"}, {"used_percent": 32, "remaining_percent": 68},
                        {"limit": "bad", "used": "8000"}, {"limit": "25000", "used": "NaN"},
                        {"limit": "Infinity", "used": "8000"}, {"limit": "25000", "used": -1},
                        {"limit": True, "used": "8000"}, {"limit": "25000", "used": True},
                        {"limit": 10**1000, "used": "8000"}):
            with self.subTest(monthly=monthly):
                usage = fixture("codex_enterprise_usage.json")
                usage["spend_control"]["individual_limit"] = monthly
                with self.assertRaises(QuotaFetchError):
                    self._fetch(usage)
                usage["rate_limit"] = fixture("codex_wham_usage.json")["rate_limit"]
                self.assertEqual(len(self._fetch(usage).windows), 1)

    def test_missing_or_invalid_reset_stays_unknown(self):
        for reset in (None, "bad", "NaN", "Infinity", 1e100):
            with self.subTest(reset=reset):
                usage = fixture("codex_enterprise_usage.json")
                usage["spend_control"]["individual_limit"]["reset_at"] = reset
                self.assertIsNone(self._fetch(usage).windows[0].resets_at)
