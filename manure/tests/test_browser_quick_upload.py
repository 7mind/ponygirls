"""Upload page and CLI view in real Chromium against the actual target: staging (paste, picker, drop), exact stored
bytes, the one-time external password pattern, retries without a second artifact, settings, layout and CLI copy."""
import json
from pathlib import Path
import socket
import subprocess
import unittest
import urllib.request
from unittest.mock import patch

import browser_fixtures as bf

CHECKS = 6


class QuickUploadBrowserTests(unittest.TestCase):
    def test_upload_page_and_cli_view(self):
        fix = bf.start_server(suffix_mode="path", config_overrides={
            "api_origin": "http://manure-http.test:0",
            "loopback_dev": False, "allow_insecure_http": True,
            "rate_limit_per_min": 10000, "login_rate_per_min_per_ip": 1000})
        self.addCleanup(fix.close)
        payload = {"base": fix.api_base, "login": fix.identity.login, "loginPassword": fix.identity.password,
                   "userId": fix.identity.user_id, "token": fix.identity.token,
                   "core": bf.playwright_core_path(), "browser": bf.chromium_bin(),
                   "resolver": "MAP manure-http.test 127.0.0.1"}
        result = subprocess.run([bf.node_bin(), str(Path(__file__).resolve().parent / "browser/upload.mjs")],
                                input=json.dumps(payload).encode(), capture_output=True, timeout=300)
        report = json.loads(result.stdout or b"[]")
        self.assertEqual(result.returncode, 0, [check for check in report if not check["ok"]] or result.stderr.decode()[-2000:])
        self.assertEqual(len(report), CHECKS)
        for check in report:
            print("ok - " + check["name"])
        binary = next(check["data"] for check in report if check["data"] is not None)
        # A separate client has no browser session or bearer token: the public content URL itself must suffice for
        # a remote agent, not just the API.
        lookup = socket.getaddrinfo
        def local_dns(host, port, *args, **kw):
            return lookup("127.0.0.1" if host == "manure-http.test" else host, port, *args, **kw)
        with patch("socket.getaddrinfo", local_dns):
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(urllib.request.Request(binary["link"], headers={"Accept": "application/octet-stream"}), timeout=15) as response:
                raw = response.read(binary["size"] + 1)
        self.assertEqual(raw, bytes((i * 31 + 17) % 256 for i in range(binary["size"])))
