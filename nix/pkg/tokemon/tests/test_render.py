"""Table-rendering smoke tests over the public build_table entry (BA)."""

from __future__ import annotations

import io
import unittest
from datetime import datetime, timezone

from rich.console import Console

from tokemon.discovery import Target
from tokemon.credentials import Credential, CredentialKind
from tokemon.quota import QueryResult, QuotaSnapshot, QuotaWindow
from tokemon.render import build_table

NOW = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc)
EXPIRED = datetime(2026, 9, 1, tzinfo=timezone.utc)


def _render(
    results: list[QueryResult], force_terminal: bool = False, show_invalid: bool = True, mask_logins: bool = False
) -> str:
    buffer = io.StringIO()
    console = Console(file=buffer, width=240, force_terminal=force_terminal, color_system="256" if force_terminal else None)
    console.print(build_table(results, NOW, "test", show_invalid, mask_logins))
    return buffer.getvalue()


def _result(window: QuotaWindow | None, note: str | None, expires_at=None, error: str | None = None, extra_windows=()):
    credential = Credential(
        kind=CredentialKind.API_KEY,
        secret="s",
        refresh_token=None,
        account_id=None,
        expires_at=expires_at,
    )
    target = Target("default", "pi", "demo", "~/.pi/agent", credential, None)
    all_windows = ((window,) if window else ()) + tuple(extra_windows)
    snapshot = QuotaSnapshot(
        plan_name=None, identity="tester@example.test", windows=all_windows, note=note
    )
    return QueryResult(target=target, snapshot=snapshot if error is None else None, error=error, fetched_at=NOW)


class RenderTests(unittest.TestCase):
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

    def test_unlimited_row(self):
        window = QuotaWindow("chat", used=None, limit=None, unit="requests", resets_at=None, unlimited=True)
        text = _render([_result(window, None)])
        self.assertIn("unlimited", text)

    def test_note_and_expired_auth_are_surfaced(self):
        window = QuotaWindow("5h", used=1.0, limit=100.0, unit="%", resets_at=None)
        text = _render([_result(window, "reset credits: 0", expires_at=EXPIRED)])
        self.assertIn("reset credits: 0", text)
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

    def test_logical_rows_are_separated_by_a_rule(self):
        window = QuotaWindow("5h", used=1.0, limit=100.0, unit="%", resets_at=None)
        rule = lambda text: [line for line in text.splitlines() if line.startswith("├")]
        self.assertEqual(rule(_render([_result(window, None)])), [], "a single row needs no separator")
        self.assertEqual(len(rule(_render([_result(window, None), _result(window, None)]))), 1)

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


if __name__ == "__main__":
    unittest.main()
