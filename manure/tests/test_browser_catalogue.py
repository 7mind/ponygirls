"""Catalogue shell of the dashboard redesign in real Chromium: one document scroller, sticky chrome,
infinite loading with an end marker, state-preserving Back and the in-app delete dialog."""
import json
from pathlib import Path
import subprocess
import unittest

import browser_fixtures as bf

RECORDS = 60


class CatalogueShellTests(unittest.TestCase):
    def test_catalogue_scroll_loading_state_and_dialogs(self):
        fix = bf.start_server(suffix_mode="separate", config_overrides={"rate_limit_per_min": 10000, "login_rate_per_min_per_ip": 1000})
        self.addCleanup(fix.close)
        records = [bf.upload_fixture(fix, name=f"shell-record-{index:02}", kind="file", visibility=("internal", "external", "public")[index % 3],
                                     files={"note.txt": b"x"})["artifact_id"] for index in range(RECORDS)]
        victim = bf.upload_fixture(fix, name="shell-delete-victim", kind="file", visibility="internal", files={"note.txt": b"x"})["artifact_id"]
        payload = {"base": fix.api_base, "login": fix.identity.login, "loginPassword": fix.identity.password, "userId": fix.identity.user_id,
                   "records": records, "prefix": "shell-record-", "victim": victim, "victimName": "shell-delete-victim",
                   "core": bf.playwright_core_path(), "browser": bf.chromium_bin(), "resolver": bf.HOST_RESOLVER_RULES}
        result = subprocess.run([bf.node_bin(), str(Path(__file__).resolve().parent / "browser/catalogue.mjs")],
                                input=json.dumps(payload).encode(), capture_output=True, timeout=240)
        report = json.loads(result.stdout or b"[]")
        self.assertEqual(result.returncode, 0, [check for check in report if not check["ok"]] or result.stderr.decode()[-2000:])
        self.assertEqual(len(report), 4)
        for check in report:
            print("ok - " + check["name"])
