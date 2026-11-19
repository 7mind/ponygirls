"""Layout quiescence of the catalogue and the artifact page's file list in real Chromium (UX-JIT): with scrollbars that
take space, at 100 % and 125 % display scaling, around the window height where each view starts to scroll, the scroll
geometry settles and stays unchanged (browser/layout-stability.mjs, shared/ui-web/tests/layout-quiescence.mjs)."""
import json
from pathlib import Path
import subprocess
import unittest

import browser_fixtures as bf

# Few enough that each list is complete on its first page, so a taller window does not load more.
RECORDS = 6
FILES = 30
# Two views at two display scales.
CHECKS = 4


class LayoutStabilityTests(unittest.TestCase):
    def test_catalogue_and_file_list_settle(self):
        fix = bf.start_server(suffix_mode="separate", config_overrides={"rate_limit_per_min": 10000, "login_rate_per_min_per_ip": 1000})
        self.addCleanup(fix.close)
        for index in range(RECORDS - 1):
            bf.upload_fixture(fix, name=f"layout-record-{index}", kind="file", visibility="internal", files={"note.txt": b"x"})
        files = bf.upload_fixture(fix, name="layout-files", kind="dir", visibility="internal",
                                  files={f"file-{index:02}.txt": b"x" for index in range(FILES)})["artifact_id"]
        payload = {"base": fix.api_base, "login": fix.identity.login, "loginPassword": fix.identity.password, "userId": fix.identity.user_id,
                   "records": RECORDS, "files": files, "fileCount": FILES,
                   "core": bf.playwright_core_path(), "browser": bf.chromium_bin(), "resolver": bf.HOST_RESOLVER_RULES}
        result = subprocess.run([bf.node_bin(), str(Path(__file__).resolve().parent / "browser/layout-stability.mjs")],
                                input=json.dumps(payload).encode(), capture_output=True, timeout=240)
        report = json.loads(result.stdout or b"[]")
        self.assertEqual(result.returncode, 0, [check for check in report if not check["ok"]] or result.stderr.decode()[-2000:])
        self.assertEqual(len(report), CHECKS)
        for check in report:
            print("ok - " + check["name"])
