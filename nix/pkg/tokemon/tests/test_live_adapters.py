"""Dual-tests production leg against live quota endpoints.

Evil-Communication tier (third-party APIs) — quarantined and opt-in:
run with TOKEMON_LIVE=1.  The same adapter contract asserted here runs in
tests/test_adapters.py against the scripted dummy on every test run.
"""

from __future__ import annotations

import os
import pathlib
import unittest

from tokemon.adapters import adapter_for
from tokemon.discovery import discover_targets
from tokemon.quota import QuotaFetchError
from tokemon.transport import TransportError, UrllibTransport

LIVE = os.environ.get("TOKEMON_LIVE") == "1"
ADAPTER_PROVIDERS = {"anthropic", "openai-codex", "github-copilot", "kimi-coding", "minimax", "openrouter", "zai"}


@unittest.skipUnless(LIVE, "evil-communication leg: set TOKEMON_LIVE=1 to run")
class LiveAdapterContractTests(unittest.TestCase):
    """Contract: fetch returns a snapshot with windows or a note, or raises
    QuotaFetchError / TransportError — never anything else."""

    @classmethod
    def setUpClass(cls):
        cls.transport = UrllibTransport(timeout_seconds=20.0)
        env = {key: value for key, value in os.environ.items()}
        cls.targets = [
            target
            for target in discover_targets(pathlib.Path.home(), env)
            if target.provider in ADAPTER_PROVIDERS and target.credential is not None
        ]

    def test_every_live_credential_satisfies_adapter_contract(self):
        self.assertTrue(self.targets, "no live credentials discovered")
        for target in self.targets:
            with self.subTest(profile=target.profile, provider=target.provider, label=target.label):
                adapter = adapter_for(target.provider)
                try:
                    snapshot = adapter.fetch(target.credential, self.transport)
                except (QuotaFetchError, TransportError):
                    continue  # allowed outcomes of the contract
                self.assertTrue(
                    snapshot.windows or snapshot.note,
                    f"{target.provider}: snapshot has neither windows nor a note",
                )


if __name__ == "__main__":
    unittest.main()
