"""Specified dashboard access editing against Chromium and the real server."""
import json
from pathlib import Path
import subprocess
import unittest

import browser_fixtures as bf


class DashboardAccessModeTests(unittest.TestCase):
    def run_access_scenarios(self, mode, include_races):
        core = bf.playwright_core_path()
        chromium = bf.chromium_bin()
        node = bf.node_bin()
        fix = bf.start_server(suffix_mode=mode, config_overrides={
            "rate_limit_per_min": 10000, "login_rate_per_min_per_ip": 1000,
        })
        self.addCleanup(fix.close)
        names = ("transition", "controls", "navigation", "logout", "failed-logout", "lost", "pending-list", "other")
        artifacts = {}
        for name in names:
            artifacts[name] = bf.upload_fixture(fix, name="access-" + name, kind="dir",
                visibility="internal", files={"index.html": b"<h1>access payload</h1>"}, expires_in_s=3600)
        incomplete = fix.http.request("POST", fix.api_base + "/api/v1/artifacts:init",
            body={"name": "access-incomplete", "kind": "dir", "visibility": "internal", "files": []},
            headers={"Authorization": "Bearer " + fix.identity.token})
        self.assertEqual(incomplete.status, 200)
        payload = {"base": fix.api_base, "token": fix.identity.token, "core": core,
            "browser": chromium, "resolver": bf.HOST_RESOLVER_RULES, "artifacts": artifacts,
            "incomplete": incomplete.json()["artifact_id"], "includeRaces": include_races}
        result = subprocess.run([node, str(Path(__file__).parent / "browser/access-modes.mjs")],
            input=json.dumps(payload).encode(), capture_output=True, timeout=240)
        self.assertEqual(result.returncode, 0, result.stderr.decode()[-3000:])
        report = json.loads(result.stdout)
        self.assertEqual(len(report), 9 if include_races else 1)
        self.assertTrue(all(check["ok"] for check in report), report)
        for check in report:
            print("ok - " + check["name"])

    def test_subdomain_access_transitions(self):
        self.run_access_scenarios("separate", include_races=False)

    def test_path_access_transitions_controls_and_races(self):
        self.run_access_scenarios("path", include_races=True)
