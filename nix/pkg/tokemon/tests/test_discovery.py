"""Config-discovery tests over a synthetic home tree (BA)."""

from __future__ import annotations

import json
import os
import pathlib
import tempfile
import unittest
from datetime import datetime, timezone

from tokemon.credentials import CredentialKind
from tokemon.discovery import DiscoveryError, discover_targets


def _write_json(path: pathlib.Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _build_home(root: pathlib.Path) -> None:
    _write_json(
        root / ".codex" / "auth.json",
        {"auth_mode": "chatgpt", "tokens": {"access_token": "codex-default", "account_id": "acc-1"}},
    )
    _write_json(
        root / ".pi" / "agent" / "auth.json",
        {
            "openrouter": {"type": "api_key", "key": "or-key"},
            "kimi-coding": {"type": "oauth", "access": "kimi-access", "refresh": "kimi-refresh", "expires": 1790679856144},
        },
    )
    _write_json(root / ".pi" / "agent" / "models.json", {"providers": {"llama-swap": {"api": "openai-completions"}}})
    _write_json(
        root / ".config" / "yolo" / "work" / "codex" / "home" / "auth.json",
        {"auth_mode": "chatgpt", "tokens": {"access_token": "codex-work", "account_id": "acc-2"}},
    )
    _write_json(
        root / ".config" / "yolo" / "work" / "pi" / "home" / "agent" / "auth.json",
        {"zai": {"type": "api_key", "key": "zai-key"}},
    )
    _write_json(
        root / ".claude" / ".credentials.json",
        {"claudeAiOauth": {"accessToken": "claude-default", "refreshToken": "claude-refresh", "expiresAt": 1790679856144}},
    )
    _write_json(
        root / ".config" / "yolo" / "work" / "claude" / "home" / ".credentials.json",
        {"claudeAiOauth": {"accessToken": "claude-work", "refreshToken": "r", "expiresAt": 1790679856144}},
    )


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = pathlib.Path(self._tmp.name)
        _build_home(self.home)
        self.environ = {"OPENROUTER_API_KEY": "or-key", "MINIMAX_API_KEY": "mm-key"}
        self.targets = discover_targets(self.home, self.environ)

    def tearDown(self):
        self._tmp.cleanup()

    def _find(self, profile: str, provider: str, label: str):
        matches = [
            t for t in self.targets if (t.profile, t.provider, t.label) == (profile, provider, label)
        ]
        self.assertEqual(len(matches), 1, f"expected exactly one {(profile, provider, label)} target: {matches}")
        return matches[0]

    def test_walks_default_and_yolo_profiles(self):
        codex_default = self._find("default", "openai-codex", "~/.codex")
        codex_work = self._find("work", "openai-codex", "~/.config/yolo/work/codex/home")
        self.assertEqual(codex_default.credential.secret, "codex-default")
        self.assertEqual(codex_default.credential.account_id, "acc-1")
        self.assertEqual(codex_work.credential.secret, "codex-work")
        self._find("work", "zai", "~/.config/yolo/work/pi/home/agent")

    def test_claude_credentials_discovered_in_default_and_yolo_profiles(self):
        claude_default = self._find("default", "anthropic", "~/.claude")
        claude_work = self._find("work", "anthropic", "~/.config/yolo/work/claude/home")
        self.assertEqual(claude_default.source, "claude")
        self.assertEqual(claude_default.credential.kind, CredentialKind.OAUTH)
        self.assertEqual(claude_default.credential.secret, "claude-default")
        self.assertEqual(claude_default.credential.refresh_token, "claude-refresh")
        self.assertEqual(
            claude_default.credential.expires_at, datetime.fromtimestamp(1790679856144 / 1000, tz=timezone.utc)
        )
        self.assertEqual(claude_work.credential.secret, "claude-work")

    def test_claude_credentials_without_oauth_token_become_note(self):
        _write_json(self.home / ".claude" / ".credentials.json", {"trustedDeviceToken": "x"})
        targets = discover_targets(self.home, self.environ)
        rows = [t for t in targets if t.provider == "anthropic" and t.label == "~/.claude"]
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0].credential)
        self.assertIn("claudeAiOauth", rows[0].note)

    def test_pi_oauth_credential_parsed_with_ms_expiry(self):
        kimi = self._find("default", "kimi-coding", "~/.pi/agent")
        self.assertEqual(kimi.credential.kind, CredentialKind.OAUTH)
        self.assertEqual(kimi.credential.refresh_token, "kimi-refresh")
        self.assertEqual(kimi.credential.expires_at, datetime.fromtimestamp(1790679856144 / 1000, tz=timezone.utc))

    def test_models_json_provider_without_credential_is_listed(self):
        llama = self._find("default", "llama-swap", "~/.pi/agent")
        self.assertIsNone(llama.credential)
        self.assertIn("models.json", llama.note)

    def test_env_credentials_listed_and_deduplicated_against_stored_secrets(self):
        env_labels = {(t.provider, t.label) for t in self.targets if t.source == "env"}
        self.assertIn(("minimax", "MINIMAX_API_KEY"), env_labels)
        self.assertNotIn(("openrouter", "OPENROUTER_API_KEY"), env_labels)

    def test_identical_credentials_across_dirs_are_merged_with_joined_labels(self):
        _write_json(
            self.home / ".pi" / "other" / "auth.json",
            {"kimi-coding": {"type": "oauth", "access": "kimi-access", "refresh": "different-refresh", "expires": 42}},
        )
        targets = discover_targets(self.home, self.environ)
        kimi_rows = [t for t in targets if t.provider == "kimi-coding"]
        self.assertEqual(len(kimi_rows), 1, f"byte-identical credential must merge: {kimi_rows}")
        self.assertEqual(kimi_rows[0].label, "~/.pi/agent, ~/.pi/other")

    def test_distinct_secrets_stay_distinct_rows(self):
        _write_json(
            self.home / ".pi" / "other" / "auth.json",
            {"kimi-coding": {"type": "oauth", "access": "kimi-access-DIFFERENT", "refresh": "r", "expires": 42}},
        )
        targets = discover_targets(self.home, self.environ)
        kimi_rows = [t for t in targets if t.provider == "kimi-coding"]
        self.assertEqual(len(kimi_rows), 2)

    def test_unreadable_json_raises_discovery_error(self):
        broken = self.home / ".codex" / "auth.json"
        broken.write_text("{not json", encoding="utf-8")
        with self.assertRaises(DiscoveryError):
            discover_targets(self.home, self.environ)

    def test_unknown_credential_type_becomes_note_without_credential(self):
        _write_json(self.home / ".pi" / "agent" / "auth.json", {"mystery": {"type": "telepathy"}})
        targets = discover_targets(self.home, os.environ)
        mystery = [t for t in targets if t.provider == "mystery"]
        self.assertEqual(len(mystery), 1)
        self.assertIsNone(mystery[0].credential)
        self.assertIn("telepathy", mystery[0].note)


if __name__ == "__main__":
    unittest.main()
