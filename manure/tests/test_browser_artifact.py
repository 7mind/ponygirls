"""Artifact page of the dashboard redesign in real Chromium: manifest in the document (tree drill-down,
filtered flat list), confirmed access changes, the external password, rename/expiry, delete, the content
handoff, and the loading/not-found states."""
import json
from pathlib import Path
import subprocess
import unittest

import browser_fixtures as bf

CHECKS = 10
SHARDS = 16
PARTS = 10


class ArtifactPageTests(unittest.TestCase):
    def test_artifact_page(self):
        fix = bf.start_server(suffix_mode="separate", config_overrides={"rate_limit_per_min": 10000, "login_rate_per_min_per_ip": 1000})
        self.addCleanup(fix.close)

        def put(name, kind, visibility, files, **options):
            return bf.upload_fixture(fix, name=name, kind=kind, visibility=visibility, files=files, **options)

        bundle = put("artifact-bundle", "dir", "internal", {"index.html": b"<h1>Isolated internal preview</h1>", "note.txt": b"hello",
                                                           "nested/\u00fcber file.txt": b"unicode download"}, empty_dirs=["empty"])
        big = put("checkpoint-shards", "dir", "internal",
                  {**{f"shard-{shard:02}/part-{part:03}.bin": b"x" * (part + 1) for shard in range(SHARDS) for part in range(PARTS)},
                   "manifest.json": b"{}"})
        protected = put("artifact-protected", "file", "external", {"note.txt": b"protected"})
        rotating = put("artifact-rotating", "file", "external", {"note.txt": b"rotating"})
        public = put("artifact-public", "dir", "public", {"index.html": b"<h1>Public preview</h1>"})
        hostile = put('<img src=x onerror=alert("xss")> artifact-hostile', "file", "internal", {"note.txt": b"inert"})
        denied = put("artifact-denied", "dir", "internal", {"index.html": b"denied"})
        access = put("artifact-access", "file", "internal", {"note.txt": b"access"})
        editable = put("artifact-editable", "file", "internal", {"note.txt": b"edit"}, expires_in_s=3600)
        payload = {"base": fix.api_base, "token": fix.identity.token, "login": fix.identity.login, "loginPassword": fix.identity.password,
                   "userId": fix.identity.user_id, "core": bf.playwright_core_path(), "browser": bf.chromium_bin(), "resolver": bf.HOST_RESOLVER_RULES,
                   "bundle": bundle["artifact_id"], "big": big["artifact_id"], "files": SHARDS * PARTS + 1,
                   "protected": protected["artifact_id"], "protectedPassword": protected["external_password"],
                   "rotating": rotating["artifact_id"], "rotatingPassword": rotating["external_password"],
                   "public": public["artifact_id"], "hostile": hostile["artifact_id"], "denied": denied["artifact_id"],
                   "access": access["artifact_id"], "editable": editable["artifact_id"]}
        result = subprocess.run([bf.node_bin(), str(Path(__file__).resolve().parent / "browser/artifact.mjs")],
                                input=json.dumps(payload).encode(), capture_output=True, timeout=300)
        report = json.loads(result.stdout or b"[]")
        self.assertEqual(result.returncode, 0, [check for check in report if not check["ok"]] or result.stderr.decode()[-2000:])
        self.assertEqual(len(report), CHECKS)
        for check in report:
            print("ok - " + check["name"])
