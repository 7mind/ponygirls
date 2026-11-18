"""Accounts end to end in real Chromium against the real Manure server and dashboard: the shared scenario of
shared/account-web/tests/e2e/flow.mjs with `accounts` enabled (sign-up with the default approval, invitations), one configured
admin and a generated key file. ACCOUNT_E2E_EVIDENCE_DIR=/absolute/dir saves the step screenshots there."""
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import unittest

import browser_fixtures as bf

ADMIN = "operator"
ACCOUNT_KEY_BYTES = 32
FLOW_TIMEOUT_S = 300
FAILURE_REPORT_CHARS = 12000


class AccountsEndToEndTests(unittest.TestCase):
    def test_accounts_flow_through_the_dashboard(self):
        work = tempfile.TemporaryDirectory(prefix="manure-accounts-")
        self.addCleanup(work.cleanup)
        admin = bf._make_identity(work.name)
        key_file = Path(work.name) / "accounts.key"
        key_file.write_text(base64.urlsafe_b64encode(secrets.token_bytes(ACCOUNT_KEY_BYTES)).decode("ascii").rstrip("="))
        key_file.chmod(0o600)
        users = [{"id": ADMIN, "type": "human", "displayName": "Operator", "enabled": True, "login": ADMIN,
                  "passwordHashFile": admin.password_hash_file, "tokens": [], "admin": True}]
        accounts = {"enabled": True, "key_file": str(key_file), "signup": {"enabled": True},
                    "enrollment": {"enabled": True}, "issuer": "Manure (127.0.0.1)"}
        fix = bf.start_server(suffix_mode="separate", config_overrides={
            "users": users, "accounts": accounts, "rate_limit_per_min": 10000, "login_rate_per_min_per_ip": 1000})
        self.addCleanup(fix.close)
        evidence = os.environ.get("ACCOUNT_E2E_EVIDENCE_DIR")
        payload = {"base": fix.api_base, "login": ADMIN, "password": admin.password,
                   "core": bf.playwright_core_path(), "browser": bf.chromium_bin(), "resolver": bf.HOST_RESOLVER_RULES,
                   "evidence": None if evidence is None else str(Path(evidence).resolve())}
        result = subprocess.run([bf.node_bin(), str(Path(__file__).resolve().parent / "browser/accounts.mjs")],
                                input=json.dumps(payload).encode(), capture_output=True, timeout=FLOW_TIMEOUT_S)
        # The report opens with the failed step and its error, then the page dumps.
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace")[:FAILURE_REPORT_CHARS])
        report = json.loads(result.stdout)
        self.assertTrue(report["ok"])
        for wait in report["waits"]:
            print(f"# waited {wait['ms']} ms for the next TOTP time step ({wait['purpose']}) in step {wait['step']}")
        print(f"ok - accounts end to end ({report['durationMs']} ms)")


if __name__ == "__main__":
    unittest.main()
