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

class FreshnessRegressionTests(unittest.TestCase):
    def test_success_age_survives_failed_query_and_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = QueryLedger(Path(directory) / 'state.sqlite', INTERVAL)
            ledger.try_claim(ENDPOINT, KEY, NOW)
            ledger.record(ENDPOINT, KEY, 200, b'old success', NOW + INTERVAL, NOW)
            later = NOW + INTERVAL
            ledger.try_claim(ENDPOINT, KEY, later)
            ledger.record(ENDPOINT, KEY, 500, b'failure', later + INTERVAL, later)
            held = ledger.try_claim(ENDPOINT, KEY, later + timedelta(seconds=1))
            self.assertEqual(held.body, b'old success')
            self.assertEqual(held.fetched_at, NOW)

    def test_late_writer_cannot_replace_new_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.sqlite'
            first = QueryLedger(path, INTERVAL)
            second = QueryLedger(path, INTERVAL)
            first.try_claim(ENDPOINT, KEY, NOW)
            later = NOW + INTERVAL
            second.try_claim(ENDPOINT, KEY, later)
            second.record(ENDPOINT, KEY, 200, b'new', later + INTERVAL, later)
            first.record(ENDPOINT, KEY, 200, b'late old', NOW + INTERVAL, NOW)
            held = first.try_claim(ENDPOINT, KEY, later + timedelta(seconds=1))
            self.assertEqual(held.body, b'new')
            self.assertEqual(held.fetched_at, later)

    def test_legacy_schema_migrates_without_guessing_success_age(self):
        import sqlite3
        from contextlib import closing
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.sqlite'
            with closing(sqlite3.connect(path)) as db:
                db.execute('CREATE TABLE endpoint_queries (endpoint TEXT NOT NULL, credential_key TEXT NOT NULL, queried_at REAL NOT NULL, next_allowed_at REAL NOT NULL, status INTEGER, body BLOB, PRIMARY KEY (endpoint, credential_key))')
                db.execute('INSERT INTO endpoint_queries VALUES (?, ?, ?, ?, ?, ?)',
                           (ENDPOINT, KEY, NOW.timestamp(), (NOW + INTERVAL).timestamp(), 429, b'old'))
                db.commit()
            ledger = QueryLedger(path, INTERVAL)
            held = ledger.try_claim(ENDPOINT, KEY, NOW)
            self.assertEqual(held.body, b'old')
            self.assertIsNone(held.fetched_at)
