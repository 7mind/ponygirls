"""Cache directory selection and the cross-process query ledger (BA)."""

from __future__ import annotations

import stat
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from tokemon.state import QueryLedger, cache_dir, state_db_path

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
INTERVAL = timedelta(minutes=5)
ENDPOINT = "https://api.anthropic.com/api/oauth/usage"
KEY = "abc"


class CacheDirTests(unittest.TestCase):
    def test_xdg_cache_home_wins_on_every_platform(self):
        home = Path("/home/user")
        environ = {"XDG_CACHE_HOME": "/var/cache/me"}
        self.assertEqual(cache_dir(home, "linux", environ), Path("/var/cache/me/tokemon"))
        self.assertEqual(cache_dir(home, "darwin", environ), Path("/var/cache/me/tokemon"))

    def test_empty_xdg_cache_home_is_unset(self):
        home = Path("/home/user")
        self.assertEqual(cache_dir(home, "linux", {"XDG_CACHE_HOME": ""}), home / ".cache" / "tokemon")

    def test_darwin_uses_library_caches(self):
        home = Path("/Users/user")
        self.assertEqual(cache_dir(home, "darwin", {}), home / "Library" / "Caches" / "tokemon")

    def test_other_platforms_use_dot_cache(self):
        home = Path("/home/user")
        self.assertEqual(state_db_path(home, "linux", {}), home / ".cache" / "tokemon" / "state.sqlite")


class QueryLedgerTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.path = Path(self._tmp.name) / "state.sqlite"
        self.ledger = QueryLedger(self.path, INTERVAL)

    def tearDown(self):
        self._tmp.cleanup()

    def test_first_claim_proceeds_and_second_is_held(self):
        first = self.ledger.try_claim(ENDPOINT, KEY, NOW)
        self.assertTrue(first.proceed)
        self.assertIsNone(first.body)
        second = self.ledger.try_claim(ENDPOINT, KEY, NOW + timedelta(seconds=30))
        self.assertFalse(second.proceed)
        self.assertEqual(second.next_allowed_at, NOW + INTERVAL)

    def test_claim_after_the_interval_proceeds_again(self):
        self.ledger.try_claim(ENDPOINT, KEY, NOW)
        later = self.ledger.try_claim(ENDPOINT, KEY, NOW + INTERVAL)
        self.assertTrue(later.proceed)

    def test_record_keeps_the_last_success_across_a_failure(self):
        self.ledger.try_claim(ENDPOINT, KEY, NOW)
        self.ledger.record(ENDPOINT, KEY, 200, b'{"ok":true}', NOW + INTERVAL, NOW)
        self.ledger.try_claim(ENDPOINT, KEY, NOW + INTERVAL)
        self.ledger.record(ENDPOINT, KEY, 429, b"no", NOW + timedelta(minutes=30), NOW + INTERVAL)
        held = self.ledger.try_claim(ENDPOINT, KEY, NOW + INTERVAL + timedelta(seconds=1))
        self.assertFalse(held.proceed)
        self.assertEqual(held.body, b'{"ok":true}')
        self.assertEqual(held.next_allowed_at, NOW + timedelta(minutes=30))

    def test_distinct_endpoints_do_not_share_a_slot(self):
        self.ledger.try_claim(ENDPOINT, KEY, NOW)
        profile = self.ledger.try_claim(ENDPOINT + "/profile", KEY, NOW)
        self.assertTrue(profile.proceed)

    def test_state_files_are_private(self):
        self.ledger.try_claim(ENDPOINT, KEY, NOW)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.path.parent.stat().st_mode), 0o700)

    def test_concurrent_claims_let_one_caller_proceed(self):
        barrier = threading.Barrier(2)
        claims = []
        errors: list[BaseException] = []

        def claim():
            barrier.wait()
            try:
                claims.append(QueryLedger(self.path, INTERVAL).try_claim(ENDPOINT, KEY, NOW))
            except BaseException as exc:
                errors.append(exc)

        threads = [threading.Thread(target=claim) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        self.assertEqual(sum(claim.proceed for claim in claims), 1)
