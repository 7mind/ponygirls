"""Connection indicator of the dashboard masthead in real Chromium against the real server (UX-M6): the pill is Live
only after an answer (also on the sign-in page, where the answer is a 401), turns Offline at once when a request fails and
within the idle interval plus the probe timeout when the tab is idle, tells a gateway page from an application error,
announces each change once, stays silent in a hidden tab, and keeps its width at 1440 and 390 px
(browser/connection.mjs; time is the browser's fake clock)."""
import json
from pathlib import Path
import subprocess
import unittest

import browser_fixtures as bf

CHECKS = 6


class ConnectionIndicatorTests(unittest.TestCase):
    def test_connection_indicator(self):
        fix = bf.start_server(suffix_mode="separate", config_overrides={"rate_limit_per_min": 10000, "login_rate_per_min_per_ip": 1000})
        self.addCleanup(fix.close)
        payload = {"base": fix.api_base, "login": fix.identity.login, "loginPassword": fix.identity.password, "userId": fix.identity.user_id,
                   "core": bf.playwright_core_path(), "browser": bf.chromium_bin(), "resolver": bf.HOST_RESOLVER_RULES}
        result = subprocess.run([bf.node_bin(), str(Path(__file__).resolve().parent / "browser/connection.mjs")],
                                input=json.dumps(payload).encode(), capture_output=True, timeout=240)
        report = json.loads(result.stdout or b"[]")
        self.assertEqual(result.returncode, 0, [check for check in report if not check["ok"]] or result.stderr.decode()[-2000:])
        self.assertEqual(len(report), CHECKS)
        for check in report:
            print("ok - " + check["name"])
