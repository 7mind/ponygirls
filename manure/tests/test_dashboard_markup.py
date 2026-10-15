"""Specified dashboard presentation contracts; no browser/network required."""
from html.parser import HTMLParser
from pathlib import Path
import unittest

WEB = Path(__file__).resolve().parents[1] / "web"


class Elements(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.ids = {}
        self.sorts = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if "id" in attributes:
            self.ids[attributes["id"]] = (tag, attributes)
        if "data-sort" in attributes:
            self.sorts.append((tag, attributes))


class DashboardMarkupTests(unittest.TestCase):
    def setUp(self):
        self.html = (WEB / "dashboard/index.html").read_text()
        self.elements = Elements(self.html)

    def test_catalogue_is_an_accessible_sortable_table(self):
        self.assertEqual(self.elements.ids["artifact-list"][0], "tbody")
        fields = {attrs["data-sort"] for tag, attrs in self.elements.sorts if tag == "button"}
        self.assertEqual(fields, {"name", "kind", "visibility", "state", "total_bytes", "file_count", "created_at", "expires_at", "created_by_user"})
        self.assertIn('aria-sort="descending"', self.html)

    def test_infinite_scroll_has_keyboard_and_failure_controls(self):
        for key in ("load-more-button", "retry-list-button", "list-sentinel", "empty-state"):
            self.assertIn(key, self.elements.ids)
        self.assertNotIn("next-button", self.elements.ids)
        self.assertNotIn("prev-button", self.elements.ids)
        self.assertEqual(self.elements.ids["results-panel"][1]["tabindex"], "0")
        self.assertEqual(self.elements.ids["list-error"][1]["role"], "alert")

    def test_detail_has_file_table_and_transient_password_actions(self):
        self.assertEqual(self.elements.ids["file-list"][0], "tbody")
        for key in ("files-status", "files-retry-button", "copy-id-button", "copy-link-button", "rotate-copy-button", "rotate-dismiss-button"):
            self.assertIn(key, self.elements.ids)
        self.assertIn("hidden", self.elements.ids["rotate-output"][1])

    def test_dashboard_distinguishes_session_unavailability_from_login(self):
        for key in ("workspace-shell", "session-section", "session-status", "session-retry-button"):
            self.assertIn(key, self.elements.ids)
        self.assertIn("hidden", self.elements.ids["workspace-shell"][1])
        self.assertEqual(self.elements.ids["token-input"][1]["type"], "password")

    def test_both_shells_offer_dark_mode_without_external_assets(self):
        for shell in ("dashboard", "unlock"):
            css = (WEB / shell / "styles.css").read_text()
            self.assertIn("prefers-color-scheme: dark", css)
            html = (WEB / shell / "index.html").read_text()
            self.assertNotIn("<style>", html)
            self.assertNotIn("<script>", html)
            self.assertNotIn('src="https://', html)
            self.assertNotIn('href="https://', html)
