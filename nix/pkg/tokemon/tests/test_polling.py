"""Identity-coalescing tests: same reported account = one row (BA)."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from tokemon.discovery import Target
from tokemon.polling import coalesce_by_identity
from tokemon.quota import QueryResult, QuotaSnapshot
from tokemon.credentials import Credential, CredentialKind

NOW = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc)


def _credential(secret: str) -> Credential:
    return Credential(kind=CredentialKind.OAUTH, secret=secret, refresh_token=None, account_id=None, expires_at=None, stores=())


def _result(provider: str, label: str, secret: str, identity: str | None):
    target = Target("default", "pi", provider, label, _credential(secret), None)
    snapshot = QuotaSnapshot(plan_name=None, identity=identity, windows=(), note=None)
    return QueryResult(target=target, snapshot=snapshot, error=None, fetched_at=NOW, rate_limit=None)


class CoalesceByIdentityTests(unittest.TestCase):
    def test_same_identity_merges_with_joined_provenance(self):
        results = [
            _result("openai-codex", "~/.codex", "token-a", "team@7mind.io"),
            _result("openai-codex", "~/.pi/agent, ~/.pi/agent-xiaomi-ams", "token-b", "team@7mind.io"),
        ]
        merged = coalesce_by_identity(results)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].target.label, "~/.codex, ~/.pi/agent, ~/.pi/agent-xiaomi-ams")

    def test_different_identities_stay_separate(self):
        results = [
            _result("openai-codex", "~/.codex", "token-a", "one@example.test"),
            _result("openai-codex", "~/.pi/agent", "token-b", "two@example.test"),
        ]
        self.assertEqual(len(coalesce_by_identity(results)), 2)

    def test_same_identity_different_providers_stay_separate(self):
        results = [
            _result("openai-codex", "~/.codex", "token-a", "same@example.test"),
            _result("kimi-coding", "~/.pi/agent", "token-b", "same@example.test"),
        ]
        self.assertEqual(len(coalesce_by_identity(results)), 2)

    def test_rows_without_identity_pass_through_unchanged(self):
        results = [
            _result("zai", "~/.pi/agent", "token-a", None),
            _result("zai", "~/.pi/other", "token-a", None),
        ]
        merged = coalesce_by_identity(results)
        self.assertEqual(merged, results)


if __name__ == "__main__":
    unittest.main()
