"""Table-rendering smoke tests over the public build_table entry (BA)."""

from __future__ import annotations

import io
import re
import unittest
from datetime import datetime, timedelta, timezone
from dataclasses import replace

from rich.cells import cell_len
from rich.console import Console

from tokemon.discovery import Target
from tokemon.credentials import Credential, CredentialKind
from tokemon.quota import QueryResult, QuotaSnapshot, QuotaWindow, RateLimit
from tokemon.render import PROVIDER_STYLES, _fmt_amount, _provider_style, _retry_qualifier, _used_percent, build_table

NOW = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc)
EXPIRED = datetime(2026, 9, 1, tzinfo=timezone.utc)


def _render(
    results: list[QueryResult],
    force_terminal: bool = False,
    show_invalid: bool = True,
    mask_logins: bool = False,
    mask_profiles: bool = False,
    width: int | None = None,
) -> str:
    buffer = io.StringIO()
    console = Console(file=buffer, width=240, force_terminal=force_terminal, color_system="256" if force_terminal else None)
    console.print(build_table(results, NOW, "test", show_invalid, mask_logins, mask_profiles, width))
    return buffer.getvalue()


def _table_width(table) -> int:
    return table.width


def _lines(results: list[QueryResult], width: int | None, show_invalid: bool = False, mask_logins: bool = False) -> list[str]:
    """The table as printed on a console of ``width`` columns (240 when unlimited), without the title line."""
    buffer = io.StringIO()
    console = Console(file=buffer, width=240 if width is None else width)
    console.print(build_table(results, NOW, None, show_invalid, mask_logins, False, width))
    return [line.rstrip() for line in buffer.getvalue().splitlines()]


def _cells(line: str) -> list[str]:
    """The cells of a table line: at least two spaces apart, no double space inside."""
    return re.split(r"\s{2,}", line.strip())


def _account(profile: str, provider: str, label: str, login: str | None, plan: str | None, windows, note: str | None = None) -> QueryResult:
    target = Target(profile, "pi", provider, label, None, None)
    snapshot = QuotaSnapshot(plan_name=plan, identity=login, windows=tuple(windows), note=note)
    return QueryResult(target=target, snapshot=snapshot, error=None, fetched_at=NOW, rate_limit=None)


def _captured() -> list[QueryResult]:
    """The three accounts of the captured `tokemon` screen."""
    work = "~/.config/yolo/work/pi/home/agent"
    return [
        _account("work", "anthropic", work, "someone@example.com", None, [QuotaWindow("extra usage", 1204.5, 2000.0, "USD", None)]),
        _account("default", "anthropic", "~/.pi/agent", "someone@example.org", None, [QuotaWindow("extra usage", 1961.1, 2000.0, "USD", None)]),
        _account("default, work", "openai-codex", f"~/.pi/agent, {work}", "someone@example.com", None,
                 [QuotaWindow("credits", None, None, "credits", None, unlimited=True)]),
    ]


def _rate_limited(provider: str = "anthropic") -> QueryResult:
    target = Target("default", "pi", provider, "~/.pi/agent", None, None)
    retry_at = NOW + timedelta(minutes=55, seconds=28)
    return QueryResult(target=target, snapshot=None, error="rate limited (HTTP 429) by https://example.test",
                       fetched_at=NOW, rate_limit=RateLimit(retry_at))


def _result(window: QuotaWindow | None, note: str | None, expires_at=None, error: str | None = None, extra_windows=()):
    credential = Credential(
        kind=CredentialKind.API_KEY,
        secret="s",
        refresh_token=None,
        account_id=None,
        expires_at=expires_at,
        stores=(),
    )
    target = Target("default", "pi", "demo", "~/.pi/agent", credential, None)
    all_windows = ((window,) if window else ()) + tuple(extra_windows)
    snapshot = QuotaSnapshot(
        plan_name=None, identity="tester@example.test", windows=all_windows, note=note
    )
    return QueryResult(
        target=target, snapshot=snapshot if error is None else None, error=error, fetched_at=NOW, rate_limit=None
    )


def _login_result(provider: str, login: str) -> QueryResult:
    target = Target("default", "pi", provider, "~/.pi/agent", None, None)
    window = QuotaWindow("5h", used=1.0, limit=100.0, unit="%", resets_at=None)
    snapshot = QuotaSnapshot(plan_name=None, identity=login, windows=(window,), note=None)
    return QueryResult(target=target, snapshot=snapshot, error=None, fetched_at=NOW, rate_limit=None)


def _profile_result(profile: str, label: str, window: QuotaWindow | None, error: str | None = None) -> QueryResult:
    target = Target(profile, "pi", "demo", label, None, None)
    snapshot = QuotaSnapshot(plan_name=None, identity=None, windows=(window,) if window else (), note=None)
    return QueryResult(
        target=target, snapshot=snapshot if error is None else None, error=error, fetched_at=NOW, rate_limit=None
    )


class RenderTests(unittest.TestCase):
    def test_cached_values_show_stale_age_at_five_minutes(self):
        result = _result(QuotaWindow("5h", 50, 100, "%", None), None)
        for seconds, stale in ((299, False), (300, True), (3600, True)):
            with self.subTest(seconds=seconds):
                cached = replace(result, cached=True, fetched_at=NOW - timedelta(seconds=seconds))
                text = _render([cached])
                self.assertIn("50%", text)
                self.assertEqual("stale" in text, stale)
                if stale:
                    self.assertIn(f"{seconds // 60}m old", text)
        # Other providers' existing timestamps do not acquire cache semantics.
        self.assertNotIn("stale", _render([replace(result, fetched_at=EXPIRED)]))

    def test_network_success_ages_without_another_cache_read(self):
        result = _result(QuotaWindow("5h", 50, 100, "%", None), None)
        old = NOW - timedelta(minutes=10)
        result = replace(result, fetched_at=old, snapshot=replace(result.snapshot, fetched_at=old))
        self.assertIn("stale", _render([result]))

    def test_narrow_table_retains_stale_warning_when_its_marker_does_not_fit(self):
        result = replace(_result(QuotaWindow("5h", 50, 100, "%", None), None),
                         cached=True, fetched_at=NOW - timedelta(minutes=10))
        self.assertIn("1 stale quota row", _render([result], width=40))

    def test_legacy_cached_body_has_explicit_unknown_age(self):
        result = replace(_result(QuotaWindow("5h", 50, 100, "%", None), None),
                         cached=True, fetched_at=None)
        self.assertIn("stale · age unknown", _render([result]))

    def test_low_usage_row(self):
        window = QuotaWindow("5h", used=50.0, limit=100.0, unit="%", resets_at=None)
        text = _render([_result(window, None)])
        self.assertIn("50%", text)
        self.assertIn("ok", text)
        self.assertIn("█", text)

    def test_exhausted_flag_wins(self):
        window = QuotaWindow("5h", used=10.0, limit=100.0, unit="%", resets_at=None, exhausted=True)
        text = _render([_result(window, None)])
        self.assertIn("EXHAUSTED", text)

    # regression: a ChatGPT credit balance was rendered as dollars ($62500.00)
    def test_credit_balance_is_a_plain_rounded_count(self):
        window = QuotaWindow("credits", used=None, limit=62500.4, unit="credits", resets_at=None)
        text = _render([_result(window, None)])
        self.assertIn(" 62500 ", text)
        self.assertNotIn("$", text)

    def test_non_dollar_currency_uses_its_own_symbol(self):
        window = QuotaWindow("extra usage", used=12.34, limit=200.0, unit="EUR", resets_at=None)
        self.assertIn("€12.34 / €200.00", _render([_result(window, None)]))

    def test_unlimited_row(self):
        window = QuotaWindow("chat", used=None, limit=None, unit="requests", resets_at=None, unlimited=True)
        text = _render([_result(window, None)])
        self.assertIn("unlimited", text)

    def test_note_and_expired_auth_are_surfaced(self):
        window = QuotaWindow("5h", used=1.0, limit=100.0, unit="%", resets_at=None)
        text = _render([_result(window, "resets: 0", expires_at=EXPIRED)])
        self.assertIn("resets: 0", text)
        self.assertIn("auth expired", text)

    def test_error_row_keeps_target_visible(self):
        text = _render([_result(None, None, error="QuotaFetchError: auth rejected (HTTP 401)")])
        self.assertIn("demo", text)
        self.assertIn("auth rejected", text)

    def test_rows_without_windows_hidden_and_counted_in_caption(self):
        window = QuotaWindow("5h", used=50.0, limit=100.0, unit="%", resets_at=None)
        results = [
            _result(window, None),
            _result(None, None, error="QuotaFetchError: auth rejected (HTTP 401)"),
            _result(None, "no quota endpoint"),
        ]
        text = _render(results, show_invalid=False)
        self.assertIn("50%", text)
        self.assertNotIn("auth rejected", text)
        self.assertNotIn("no quota endpoint", text)
        self.assertIn("2 rows hidden: 1 error, 1 without quota data", text)

    def test_show_invalid_renders_all_rows_without_caption(self):
        results = [_result(None, None, error="QuotaFetchError: auth rejected (HTTP 401)")]
        text = _render(results, show_invalid=True)
        self.assertIn("auth rejected", text)
        self.assertNotIn("hidden", text)

    def test_reset_countdown(self):
        window = QuotaWindow("5h", used=1.0, limit=100.0, unit="%", resets_at=NOW)
        text = _render([_result(window, None)])
        self.assertIn("reset due", text)

    def test_login_column_shows_identity(self):
        window = QuotaWindow("5h", used=1.0, limit=100.0, unit="%", resets_at=None)
        text = _render([_result(window, None)])
        self.assertIn("tester@example.test", text)

    def test_row_banding_alternates_per_logical_row(self):
        window = QuotaWindow("5h", used=1.0, limit=100.0, unit="%", resets_at=None)
        single = _render([_result(window, None)], force_terminal=True)
        self.assertNotIn("\x1b[48;", single, "first logical row must be unbanded")
        double = _render([_result(window, None), _result(window, None)], force_terminal=True)
        self.assertIn("\x1b[48;", double, "second logical row must carry the band style")

    def test_mask_logins_keeps_two_leading_characters(self):
        window = QuotaWindow("5h", used=1.0, limit=100.0, unit="%", resets_at=None)
        text = _render([_result(window, None)], mask_logins=True)
        self.assertNotIn("tester@example.test", text)
        self.assertIn("te" + "*" * (len("tester@example.test") - 2), text)

    def test_mask_profiles_numbers_names_and_masks_them_in_paths(self):
        window = QuotaWindow("5h", used=1.0, limit=100.0, unit="%", resets_at=None)
        results = [
            _profile_result("work", "~/.config/yolo/work/codex/home", window),
            _profile_result("default, zeta", "~/.pi/agent, ~/.config/yolo/zeta/pi/home/agent", window),
            _profile_result(
                "zeta",
                "~/.config/yolo/zeta/pi/home/other",
                None,
                error="DiscoveryError: /home/u/.config/yolo/zeta/pi/home/other/auth.json: unreadable JSON",
            ),
        ]
        text = _render(results, mask_profiles=True)
        self.assertNotIn("work", text)
        self.assertNotIn("zeta", text)
        self.assertIn("~/.config/yolo/1/codex/home", text)
        self.assertIn("~/.config/yolo/2/pi/home/agent", text)
        self.assertIn("default, 2", text)
        self.assertIn("/home/u/.config/yolo/2/pi/home/other/auth.json", text)
        self.assertIn("~/.pi/agent", text)

    def test_mask_profiles_rewrites_only_the_profile_path_segment(self):
        window = QuotaWindow("5h", used=1.0, limit=100.0, unit="%", resets_at=None)
        text = _render([_profile_result("home", "~/.config/yolo/home/pi/home/agent", window)], mask_profiles=True)
        self.assertIn("~/.config/yolo/1/pi/home/agent", text)

    def test_mask_profiles_numbering_ignores_hidden_rows(self):
        window = QuotaWindow("5h", used=1.0, limit=100.0, unit="%", resets_at=None)
        results = [
            _profile_result("alpha", "~/.config/yolo/alpha/codex/home", None, error="QuotaFetchError: x"),
            _profile_result("beta", "~/.config/yolo/beta/codex/home", window),
        ]
        text = _render(results, show_invalid=False, mask_profiles=True)
        self.assertIn("~/.config/yolo/2/codex/home", text)

    def test_unmasked_profiles_are_shown_verbatim(self):
        window = QuotaWindow("5h", used=1.0, limit=100.0, unit="%", resets_at=None)
        text = _render([_profile_result("work", "~/.config/yolo/work/codex/home", window)])
        self.assertIn("~/.config/yolo/work/codex/home", text)

    def test_rows_are_plain_lines_without_a_box_or_rules(self):
        lines = _lines([_login_result("demo", "a@example.test"), _login_result("demo", "b@example.test")], None)
        self.assertEqual(_cells(lines[0])[0], "Provider")
        self.assertEqual(len(lines), 5, "a header, then each account's row and its path line")
        self.assertNotRegex("\n".join(lines), "[│┃┏┡├└─━]")

    def test_window_lines_are_contiguous_without_blank_rows(self):
        first = QuotaWindow("primary (7d)", used=91.0, limit=100.0, unit="%", resets_at=None)
        second = QuotaWindow("credits", used=None, limit=0.0, unit="USD", resets_at=None)
        result = _result(first, None, extra_windows=(second,))
        body_lines = [line for line in _render([result]).splitlines() if "primary (7d)" in line or "credits" in line]
        self.assertEqual(len(body_lines), 2, f"one rendered line per window expected: {body_lines}")
        self.assertIn("primary (7d)", body_lines[0])
        self.assertIn("credits", body_lines[1])

    def test_provider_cell_lists_config_paths_one_per_line(self):
        window = QuotaWindow("5h", used=1.0, limit=100.0, unit="%", resets_at=None)
        text = _render([_result(window, None)])
        self.assertNotIn("demo (~", text, "paths must not be a parenthesised suffix anymore")
        lines = text.splitlines()
        head_index = next(i for i, line in enumerate(lines) if "tester@example.test" in line)
        self.assertIn("demo", lines[head_index])
        self.assertIn("~/.pi/agent", lines[head_index + 1])


class ResponsiveColumnsTests(unittest.TestCase):
    ALL_HEADERS = (
        "Provider",
        "Profile",
        "Src",
        "Login",
        "Plan",
        "Window",
        "Used / limit",
        "Usage",
        "Resets",
        "Status",
    )
    CORE_HEADERS = ("Provider", "Profile", "Window", "Used / limit", "Status")

    def _results(self):
        window = QuotaWindow("primary (5h)", used=12.5, limit=100.0, unit="%", resets_at=None)
        target = Target("default", "pi", "meta", "~/.pi/agent", None, None)
        ok = QueryResult(
            target=target,
            snapshot=QuotaSnapshot(
                plan_name="Muse Code High Usage",
                identity="user@example.test",
                windows=(window,),
                note=None,
            ),
            error=None,
            fetched_at=NOW,
            rate_limit=None,
        )
        err = _result(None, None, error="QuotaFetchError: meta session expired (HTTP 401) — run /login meta")
        return [ok, err]

    def _headers(self, table) -> list[str]:
        return list(table.headers)

    def _build(self, width: int | None):
        return build_table(self._results(), NOW, "test", True, False, False, width)

    def test_no_width_keeps_every_column(self):
        self.assertEqual(self._headers(self._build(None)), list(self.ALL_HEADERS))

    def test_provider_is_the_first_column(self):
        self.assertEqual(self._headers(self._build(None))[0], "Provider")

    def test_rows_sort_by_provider_then_login(self):
        results = [
            _login_result("zai", "b@example.test"),
            _login_result("anthropic", "z@example.test"),
            _login_result("anthropic", "a@example.test"),
        ]
        text = _render(results)
        first = text.find("a@example.test")
        second = text.find("z@example.test")
        third = text.find("b@example.test")
        self.assertTrue(0 <= first < second < third, text)

    def test_provider_colours_stay_distinct_across_families(self):
        families = [
            "anthropic",
            "openai-codex",
            "github-copilot",
            "kimi-coding",
            "meta",
            "minimax",
            "openrouter",
            "vercel-ai-gateway",
            "xai",
            "zai",
            "xiaomi",
            "qwen-token-plan",
        ]
        styles = {_provider_style(provider) for provider in families}
        self.assertEqual(len(styles), len(families))
        self.assertIn("xiaomi-token-plan-ams", PROVIDER_STYLES)
        self.assertEqual(_provider_style("xiaomi-token-plan-ams"), _provider_style("xiaomi"))
        unknown = _provider_style("some-future-provider")
        self.assertEqual(unknown, _provider_style("some-future-provider"))

    def test_provider_name_carries_a_colour(self):
        # A style close before the name: rich emits an SGR sequence ending in
        # "m" right before the styled provider name.
        window = QuotaWindow("5h", used=1.0, limit=100.0, unit="%", resets_at=None)
        text = _render([_result(window, None)], force_terminal=True)
        self.assertIn("demo", text)
        self.assertRegex(text, "mdemo")

    def test_status_note_is_shown_once_for_multiwindow_rows(self):
        first = QuotaWindow("primary (7d)", used=91.0, limit=100.0, unit="%", resets_at=None)
        second = QuotaWindow("credits", used=None, limit=0.0, unit="credits", resets_at=None)
        text = _render([_result(first, "resets: 2", extra_windows=(second,))])
        self.assertEqual(text.count("resets: 2"), 1)

    def test_paths_hide_before_columns_drop(self):
        full = self._build(None)
        self.assertIn("~/.pi/agent", _render(self._results(), width=None))
        compact = self._build(_table_width(full) - 1)
        self.assertEqual(self._headers(compact), list(self.ALL_HEADERS))
        self.assertNotIn("~/.pi/agent", _render(self._results(), width=_table_width(full) - 1))
        self.assertEqual(compact.notes, ())

    def test_columns_hide_in_order_src_plan_login_resets_usage(self):
        hidden_steps: list[list[str]] = []
        for width in range(_table_width(self._build(None)), 39, -1):
            headers = self._headers(self._build(width))
            for kept in self.CORE_HEADERS:
                self.assertIn(kept, headers, width)
            hidden = [header for header in self.ALL_HEADERS if header not in headers]
            if not hidden_steps or hidden_steps[-1] != hidden:
                hidden_steps.append(hidden)
        self.assertEqual(
            hidden_steps,
            [
                [],
                ["Src"],
                ["Src", "Plan"],
                ["Src", "Login", "Plan"],
                ["Src", "Login", "Plan", "Resets"],
                ["Src", "Login", "Plan", "Usage", "Resets"],
            ],
        )

    def test_hidden_columns_are_named_under_the_table_in_display_order(self):
        table = self._build(80)
        hidden = [header for header in self.ALL_HEADERS if header not in self._headers(table)]
        self.assertTrue(hidden)
        self.assertEqual(table.notes, (f"hidden at this width: {', '.join(hidden)}",))
        self.assertIn(table.notes[0], _render(self._results(), width=80))
        self.assertNotIn("hidden at this width", _render(self._results(), width=None))

    def test_tiny_width_keeps_core_columns(self):
        table = self._build(40)
        self.assertEqual(self._headers(table), list(self.CORE_HEADERS))


class PlainTableTests(unittest.TestCase):
    def test_money_reads_with_thousands_separators(self):
        self.assertEqual(
            [_fmt_amount(1204.5, "USD"), _fmt_amount(1234567.891, "EUR"), _fmt_amount(999.999, "GBP"), _fmt_amount(-1500, "USD")],
            ["$1,204.50", "€1,234,567.89", "£1,000.00", "$-1,500.00"],
        )
        self.assertEqual(_fmt_amount(62500.4, "credits"), "62500", "a credit balance is a count, not money")

    def test_captured_screen_at_120_columns(self):
        self.assertEqual(
            _lines(_captured(), 120, mask_logins=True),
            [
                "Provider      Profile        Login                Window                Used / limit  Usage       Resets  Status",
                "anthropic     work           so*****************  extra usage  $1,204.50 / $2,000.00  ██████░░░░       —  ok 60%",
                "anthropic     default        so*****************  extra usage  $1,961.10 / $2,000.00  ██████████       —  low 98%",
                "openai-codex  default, work  so*****************  credits                  unlimited  —                —  unlimited",
                "hidden at this width: Src, Plan",
            ],
        )

    def test_captured_screen_at_80_columns_keeps_provider_and_status(self):
        self.assertEqual(
            _lines(_captured(), 80, mask_logins=True),
            [
                "Provider      Profile        Window                Used / limit  Status",
                "anthropic     work           extra usage  $1,204.50 / $2,000.00  ok 60%",
                "anthropic     default        extra usage  $1,961.10 / $2,000.00  low 98%",
                "openai-codex  default, work  credits                  unlimited  unlimited",
                "hidden at this width: Src, Login, Plan, Usage, Resets",
            ],
        )

    def test_wide_table_lists_the_paths_under_each_provider(self):
        lines = _lines(_captured(), 170)
        self.assertEqual(
            [_cells(line) for line in lines],
            [
                ["Provider", "Profile", "Src", "Login", "Plan", "Window", "Used / limit", "Usage", "Resets", "Status"],
                ["anthropic", "work", "pi", "someone@example.com", "extra usage", "$1,204.50 / $2,000.00", "██████░░░░", "—", "ok 60%"],
                ["~/.config/yolo/work/pi/home/agent"],
                ["anthropic", "default", "pi", "someone@example.org", "extra usage", "$1,961.10 / $2,000.00", "██████████", "—", "low 98%"],
                ["~/.pi/agent"],
                ["openai-codex", "default, work", "pi", "someone@example.com", "credits", "unlimited", "—", "—", "unlimited"],
                ["~/.pi/agent"],
                ["~/.config/yolo/work/pi/home/agent"],
            ],
        )

    def test_every_line_fits_60_to_170_columns_and_no_header_is_squeezed(self):
        long_error = _result(None, None, error="QuotaFetchError: meta session expired (HTTP 401) — run /login meta")
        results = [*_captured(), _rate_limited("zai"), long_error, _result(None, "no quota endpoint")]
        for show_invalid in (False, True):
            for width in (60, 80, 100, 120, 170):
                with self.subTest(width=width, show_invalid=show_invalid):
                    lines = _lines(results, width, show_invalid=show_invalid, mask_logins=True)
                    self.assertTrue(all(cell_len(line) <= width for line in lines), lines)
                    headers = _cells(lines[0])
                    self.assertTrue({"Provider", "Profile", "Window", "Used / limit", "Status"} <= set(headers), lines[0])
                    self.assertTrue(set(headers) <= set(ResponsiveColumnsTests.ALL_HEADERS), lines[0])
                    self.assertTrue(any(re.match(r"zai .* rate limited", line) for line in lines), lines)

    def test_title_is_one_line_whatever_the_width(self):
        note = "updated 21:01 · refresh in 4:11 · r refresh · i show invalid · q quit"
        for width in (60, 80, 120):
            buffer = io.StringIO()
            Console(file=buffer, width=width).print(build_table(_captured(), NOW, note, False, False, False, width))
            lines = buffer.getvalue().splitlines()
            self.assertTrue(lines[0].startswith("tokemon · updated 21:01"), lines[0])
            self.assertEqual(_cells(lines[1])[0], "Provider")
            self.assertLessEqual(cell_len(lines[0]), width)
        self.assertEqual(lines[0], f"tokemon · {note}")
        self.assertEqual(_cells(_lines(_captured(), 120)[0])[0], "Provider", "no title line without a refresh note")


class StatusTests(unittest.TestCase):
    def _status(self, results: list[QueryResult], width: int | None, row: int = 1, show_invalid: bool = False) -> str:
        return _cells(_lines(results, width, show_invalid=show_invalid)[row])[-1]

    def test_retry_qualifier(self):
        at = lambda **delta: NOW + timedelta(**delta)
        self.assertEqual(
            [_retry_qualifier(at(minutes=55, seconds=28), NOW), _retry_qualifier(at(seconds=28), NOW),
             _retry_qualifier(at(minutes=65), NOW), _retry_qualifier(NOW, NOW), _retry_qualifier(None, NOW)],
            ["retry 55m", "retry 28s", "retry 1h05m", "retry due", None],
        )

    def test_rate_limit_status_shortens_instead_of_wrapping(self):
        results = [_rate_limited(), *_captured()]
        self.assertEqual(self._status(results, None), "rate limited (429) · retry in 55m 28s")
        self.assertEqual(self._status(results, 120), "rate limited · retry 55m")
        self.assertEqual(self._status(results, 60), "rate limited")
        for width in (60, 80, 100, 120):
            # A header, one line per window, and the note: nothing wraps onto a second row line.
            self.assertEqual(len(_lines(results, width)), 6, width)

    def test_show_invalid_hides_columns_to_keep_each_status_whole(self):
        error = "QuotaFetchError: meta session expired (HTTP 401) — run /login meta"
        results = [_rate_limited(), _result(None, None, error=error)]
        lines = _lines(results, 120, show_invalid=True)
        self.assertEqual([_cells(line)[-1] for line in lines[1:3]], ["rate limited (429) · retry in 55m 28s", error])
        self.assertEqual(lines[3], "hidden at this width: Src, Login, Plan, Resets")
        # Without the invalid rows the status shortens and every column stays.
        self.assertEqual(
            _lines(results, 100)[1:],
            [
                "anthropic  default  pi                —                  —  —           —  rate limited · retry 55m",
                "1 row hidden: 1 error",
            ],
        )

    def test_status_carries_the_used_percentage(self):
        window = lambda used, limit, **extra: QuotaWindow("w", used, limit, "USD", None, **extra)
        self.assertEqual(
            [_used_percent(window(1961.1, 2000.0)), _used_percent(window(1204.5, 2000.0)), _used_percent(window(89.99, 100.0)),
             _used_percent(window(12.6, 100.0)), _used_percent(window(57.0, 100.0)), _used_percent(window(150.0, 100.0)),
             _used_percent(window(-5.0, 100.0)), _used_percent(window(None, 100.0)), _used_percent(window(5.0, None)),
             _used_percent(window(None, None, unlimited=True))],
            [98, 60, 90, 13, 57, 150, 0, None, None, None],
        )
        # The number agrees with the Used / limit cell beside it.
        percent = QuotaWindow("5h", 12.6, 100.0, "%", None)
        self.assertEqual(_cells(_lines([_result(percent, None)], None)[1])[-3:], ["█░░░░░░░░░", "—", "ok 13%"])
        self.assertIn("13%", _cells(_lines([_result(percent, None)], None)[1]))
        exhausted = _login_result("zai", "z@example.test")
        exhausted = replace(exhausted, snapshot=replace(exhausted.snapshot, windows=(QuotaWindow("5h", 100.0, 100.0, "%", None),)))
        lines = _lines([*_captured(), exhausted], 80)
        self.assertEqual([_cells(line)[-1] for line in lines[1:5]], ["ok 60%", "low 98%", "unlimited", "EXHAUSTED 100%"])
        self.assertNotIn("Usage", _cells(lines[0]))

    def test_stale_marker_is_kept_before_a_provider_note_and_counted_when_dropped(self):
        window = QuotaWindow("weekly credits", 1961.1, 2000.0, "USD", None)
        noted = _account("default", "openai-codex", "~/.pi/agent", "someone@example.com", "ent26", [window], note="resets: 0")
        stale = replace(noted, cached=True, fetched_at=NOW - timedelta(minutes=10))
        self.assertEqual(self._status([stale], None), "low 98% · stale · 10m old · resets: 0")
        # 122 columns hold every column with the bare state; the note needs 12 more and hides nothing.
        self.assertEqual(_cells(_lines([noted], 122)[0]), list(ResponsiveColumnsTests.ALL_HEADERS))
        self.assertEqual(self._status([noted], 122), "low 98%")
        self.assertEqual(self._status([noted], 134), "low 98% · resets: 0")
        # The same row, stale: columns go so that the marker stays.
        lines = _lines([stale], 122)
        self.assertEqual(_cells(lines[1])[-1], "low 98% · stale 10m")
        self.assertEqual(lines[2], "hidden at this width: Src, Plan")
        # Too narrow for the marker: the percentage goes too, and the note under the table counts the row.
        tiny = _lines([stale], 50)
        self.assertEqual(_cells(tiny[1])[-1], "low")
        # Notes that do not fit on one line go one per line; a long one wraps, nothing of it is cut.
        self.assertEqual(tiny[2], "⚠ 1 stale quota row(s)")
        self.assertEqual(" ".join(tiny[3:]), "hidden at this width: Src, Login, Plan, Usage, Resets")

    def test_expired_auth_is_the_first_qualifier(self):
        window = QuotaWindow("5h", used=1.0, limit=100.0, unit="%", resets_at=None)
        expired = _result(window, "resets: 0", expires_at=EXPIRED)
        self.assertEqual(self._status([expired], None), "ok 1% · resets: 0 · auth expired")
        self.assertEqual(self._status([expired], 80), "ok 1% · auth expired")

    def test_cells_are_cut_with_an_ellipsis_when_the_kept_columns_do_not_fit(self):
        error = "QuotaFetchError: meta session expired (HTTP 401) — run /login meta"
        money = _account("default, work", "vercel-ai-gateway", "~/.pi/agent", None, None,
                         [QuotaWindow("monthly credits", 1204.5, 2000.0, "USD", None)])
        results = [money, _result(None, None, error=error)]
        for width in (60, 50):
            with self.subTest(width=width):
                lines = _lines(results, width, show_invalid=True)
                self.assertTrue(all(cell_len(line) <= width for line in lines), lines)
                demo, vercel = _cells(lines[1]), _cells(lines[2])
                self.assertEqual([len(_cells(lines[0])), len(demo), len(vercel)], [5, 5, 5], lines)
                self.assertRegex(demo[-1], r"^Quota.*…$")
                self.assertRegex(vercel[-1], r"^ok")
                self.assertRegex(vercel[0], r"^vercel")
        # At 60 columns no header is cut, and the quota's details give way before who it is and how it is doing.
        lines = _lines(results, 60, show_invalid=True)
        self.assertEqual(_cells(lines[0]), ["Provider", "Profile", "Window", "Used / limit", "Status"])
        self.assertEqual(_cells(lines[2]), ["vercel-ai-gate…", "default, work", "month…", "$1,204.50 /…", "ok 60%"])


if __name__ == "__main__":
    unittest.main()
