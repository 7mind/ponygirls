"""Controlled real-browser UX checks, complementing the Chromium security matrix."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import browser_fixtures as bf


class DashboardUXTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.driver = bf.playwright_core_path()
        cls.node = bf.node_bin()
        cls.firefox = os.environ.get("MANURE_FIREFOX_BIN", "")
        cls.browser = cls.firefox or bf.chromium_bin()
        cls.fix = bf.start_server(suffix_mode="separate",
                                  config_overrides={"rate_limit_per_min": 10000, "login_rate_per_min_per_ip": 1000})
        cls.expired = bf.upload_fixture(cls.fix, name="ux-expired", kind="file", visibility="internal", files={"old.txt": b"expired"}, expires_in_s=60)["artifact_id"]
        cls.records = []
        for index in range(65):
            cls.records.append(bf.upload_fixture(cls.fix, name=f"ux-record-{index:02}", kind="file",
                visibility=("internal", "external", "public")[index % 3], files={"note.txt": b"x"})["artifact_id"])
        cls.bundle = bf.upload_fixture(cls.fix, name="ux-bundle", kind="dir", visibility="internal",
            files={"index.html": b"<h1>Isolated internal preview</h1>", "note.txt": b"hello", "nested/über file.txt": b"unicode download"}, empty_dirs=["empty"])["artifact_id"]
        protected = bf.upload_fixture(cls.fix, name="ux-protected", kind="file", visibility="external", files={"note.txt": b"protected"})
        cls.protected = protected["artifact_id"]
        cls.password = protected["external_password"]
        cls.public = bf.upload_fixture(cls.fix, name="ux-public", kind="dir", visibility="public", files={"index.html": b"<h1>Public preview</h1>"})["artifact_id"]
        cls.hostile = bf.upload_fixture(cls.fix, name='<img src=x onerror=alert("xss")> ux-hostile', kind="file", visibility="internal", files={"note.txt": b"inert"})["artifact_id"]
        bf.wait_for_expiry(cls.fix,cls.expired)

    @classmethod
    def tearDownClass(cls):
        cls.fix.close()

    def test_catalogue_detail_and_session_flows(self):
        payload = {"base": self.fix.api_base, "token": self.fix.identity.token, "records": self.records,
            "bundle": self.bundle, "protectedId": self.protected, "password": self.password,
            "publicId": self.public, "expiredId": self.expired, "hostile": self.hostile,
            "browser": self.browser, "engine": "firefox" if self.firefox else "chromium",
            "suffix": self.fix.suffix, "core": self.driver,
            "artifacts": os.environ.get("MANURE_UX_ARTIFACTS", "")}
        result = subprocess.run([self.node, str(Path(__file__).resolve().parent / "browser/dashboard-ux.mjs")],
            input=json.dumps(payload).encode(), capture_output=True, timeout=240)
        self.assertEqual(result.returncode, 0, "; ".join(check["name"] + ": " + check.get("error", "ok") for check in json.loads(result.stdout)))
        report = json.loads(result.stdout)
        self.assertEqual(len(report), 23)
        self.assertTrue(all(check["ok"] for check in report), report)
        for check in report:
            print("ok - " + check["name"])
