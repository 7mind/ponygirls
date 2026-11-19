"""Dashboard controls that open artifact content, in real Chromium against the real server: the catalogue row's
Open and the artifact page's Open artifact are links that open the content in a new tab without an opener (click,
Enter, middle-click and the link address; internal, external and public artifacts; path and separate-origin content
modes), and the dashboard tab keeps its URL and state. Internal content gets its single-use grant in the new tab,
which reports a refused grant itself; a signed-out tab signs in first."""
import json
from pathlib import Path
import subprocess
import unittest

import browser_fixtures as bf

CHECKS = 3


class OpenContentTests(unittest.TestCase):
    def run_mode(self, mode):
        fix = bf.start_server(suffix_mode=mode, config_overrides={"rate_limit_per_min": 10000, "login_rate_per_min_per_ip": 1000})
        self.addCleanup(fix.close)
        artifacts = {}
        for visibility in ("internal", "external", "public"):
            page = f"<!doctype html><title>{visibility}</title><h1>{visibility.capitalize()} content</h1>".encode()
            record = bf.upload_fixture(fix, name="open-" + visibility, kind="dir", visibility=visibility, files={"index.html": page})
            artifacts[visibility] = {"id": record["artifact_id"], "url": record["content_url"]}
        payload = {"base": fix.api_base, "token": fix.identity.token, "login": fix.identity.login, "loginPassword": fix.identity.password,
                   "userId": fix.identity.user_id, "mode": mode, "artifacts": artifacts,
                   "core": bf.playwright_core_path(), "browser": bf.chromium_bin(), "resolver": bf.HOST_RESOLVER_RULES}
        result = subprocess.run([bf.node_bin(), str(Path(__file__).resolve().parent / "browser/open-content.mjs")],
                                input=json.dumps(payload).encode(), capture_output=True, timeout=240)
        report = json.loads(result.stdout or b"[]")
        self.assertEqual(result.returncode, 0, [check for check in report if not check["ok"]] or result.stderr.decode()[-2000:])
        self.assertEqual(len(report), CHECKS)
        for check in report:
            print("ok - " + mode + ": " + check["name"])

    def test_path_mode(self):
        self.run_mode("path")

    def test_separate_origin_mode(self):
        self.run_mode("separate")
