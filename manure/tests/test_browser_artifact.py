"""Artifact page of the dashboard redesign in real Chromium: manifest in the document (tree drill-down,
filtered flat list), confirmed access changes, the external password, rename/expiry, delete, the content
handoff, and the loading/not-found states."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import unittest
import urllib.parse

import browser_fixtures as bf

CHECKS = 11
SHARDS = 16
PARTS = 10


class ArtifactPageTests(unittest.TestCase):
    def test_artifact_page(self):
        viewer_dir = os.environ.get("MANURE_TEST_VIEWER_DIR", str(Path(__file__).resolve().parents[1] / "web/viewer/dist"))
        fix = bf.start_server(suffix_mode="separate", config_overrides={"rate_limit_per_min": 10000, "login_rate_per_min_per_ip": 1000,
                                                                        "viewer_dir": viewer_dir})
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
        doomed = put("artifact-doomed", "file", "internal", {"note.txt": b"doomed"})
        denied = put("artifact-denied", "dir", "internal", {"index.html": b"denied"})
        access = put("artifact-access", "file", "internal", {"note.txt": b"access"})
        editable = put("artifact-editable", "file", "internal", {"note.txt": b"edit"}, expires_in_s=3600)
        # An unfinished upload: one of its two files received.
        auth = {"Authorization": f"Bearer {fix.identity.token}"}
        blobs = {"part-a.bin": b"aaaa", "part-b.bin": b"bbbb"}
        init = fix.http.current(fix.api_base, bf.init_command({"name": "artifact-uploading", "kind": "dir", "visibility": "internal", "files": [
            {"kind": "file", "path": path, "size": len(blob), "sha256": hashlib.sha256(blob).hexdigest()} for path, blob in blobs.items()]}), headers=auth)
        self.assertEqual(init.status, 200)
        uploading = init.json()["artifact_id"]
        chunk = fix.http.request("PUT", f"{fix.api_base}/api/current/artifacts/{uploading}/chunks?" + urllib.parse.urlencode({"path": "part-a.bin", "offset": 0}),
                                 body=blobs["part-a.bin"], content_type="application/octet-stream",
                                 headers={**auth, "X-Chunk-Sha256": hashlib.sha256(blobs["part-a.bin"]).hexdigest()})
        self.assertEqual(chunk.status, 200)
        payload = {"base": fix.api_base, "token": fix.identity.token, "login": fix.identity.login, "loginPassword": fix.identity.password,
                   "userId": fix.identity.user_id, "core": bf.playwright_core_path(), "browser": bf.chromium_bin(), "resolver": bf.HOST_RESOLVER_RULES,
                   "bundle": bundle["artifact_id"], "big": big["artifact_id"], "files": SHARDS * PARTS + 1,
                   "protected": protected["artifact_id"], "protectedPassword": protected["external_password"],
                   "rotating": rotating["artifact_id"], "rotatingPassword": rotating["external_password"],
                   "public": public["artifact_id"], "hostile": hostile["artifact_id"], "doomed": doomed["artifact_id"], "denied": denied["artifact_id"],
                   "access": access["artifact_id"], "editable": editable["artifact_id"], "uploading": uploading}
        result = subprocess.run([bf.node_bin(), str(Path(__file__).resolve().parent / "browser/artifact.mjs")],
                                input=json.dumps(payload).encode(), capture_output=True, timeout=300)
        report = json.loads(result.stdout or b"[]")
        self.assertEqual(result.returncode, 0, [check for check in report if not check["ok"]] or result.stderr.decode()[-2000:])
        self.assertEqual(len(report), CHECKS)
        for check in report:
            print("ok - " + check["name"])
