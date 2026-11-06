"""Specified viewer contracts over real Chromium + owned server/PG/filesystem.

Behavioral-Active / Effectual / Good Communication: rendering and attempted
network side effects are observed through browser APIs, never mocked renderers.
These are new feature requirements, not historical regression claims.
"""
import base64
import binascii
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parent))
import browser_fixtures as bf


def two_page_pdf():
    """A self-contained PDF with real page streams, xref offsets and trailer."""
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    for number in (1, 2):
        stream = f"0 0 0 rg BT /F1 24 Tf 30 100 Td (Viewer page {number}) Tj ET\n".encode()
        objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream")
    result = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(result)
    result.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        result.extend(f"{offset:010} 00000 n \n".encode())
    result.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(result)


def png_fixture():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", binascii.crc32(kind + data) & 0xffffffff)
    # Larger than the viewport so Fit and Zoom must have observable effects.
    pixels = (b"\0" + b"\x20\x80\xc0" * 1600) * 900
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1600, 900, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b""))


MARKDOWN = b'''# Viewer specification

| Name | Value |
| --- | --- |
| GFM table | rendered |

- [x] completed task

~~removed text~~

```mermaid
flowchart LR
    A[Start] --> B[Finish]
```

```dot
digraph G { alpha -> beta; }
```

<script>window.__viewerExecuted = true</script>
<img src="https://viewer-attacker.invalid/raw.png" onerror="window.__viewerExecuted = true">
<svg onload="window.__viewerExecuted = true"></svg>
[unsafe](javascript:window.__viewerExecuted=true)
![remote](https://viewer-attacker.invalid/remote.png)
'''
SVG = b'''<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" onload="window.__viewerExecuted=true"><script>window.__viewerExecuted=true</script><rect width="120" height="80" fill="orange"/></svg>'''


class ViewerBrowserTests(unittest.TestCase):
    def run_viewers(self, mode):
        viewer_dir = Path(os.environ.get("MANURE_TEST_VIEWER_DIR", str(
            Path(__file__).resolve().parents[1] / "web/viewer/dist"))).resolve()
        self.assertTrue((viewer_dir / "viewer.js").is_file(),
                        f"Viewer bundle missing: {viewer_dir / 'viewer.js'}; build viewer assets first")
        core = bf.playwright_core_path()
        browser = bf.chromium_bin()
        node = bf.node_bin()
        fix = bf.start_server(suffix_mode=mode, config_overrides={
            "viewer_dir": str(viewer_dir), "rate_limit_per_min": 10000,
            "login_rate_per_min_per_ip": 1000})
        self.addCleanup(fix.close)
        records = {}

        def upload(key, files, *, visibility="public", kind="file"):
            record = bf.upload_fixture(fix, name="viewer-" + key, kind=kind,
                                       visibility=visibility, files=files)
            record["content_url"] = bf.content_url_for(fix, record["artifact_id"])
            # Password/token only transit stdin; never argv or browser artifacts.
            record["files"] = {name: base64.b64encode(blob).decode() for name, blob in files.items()}
            records[key] = record

        upload("markdown", {"guide ü.md": MARKDOWN})
        upload("mermaid", {"flow.mmd": b"flowchart LR\n A[Start] --> B[Finish]\n"})
        upload("dot", {"graph.dot": b"digraph G { alpha -> beta; }\n"})
        upload("svg", {"drawing.svg": SVG})
        upload("png", {"picture.png": png_fixture()})
        upload("pdf", {"document.pdf": two_page_pdf()})
        upload("malformed", {"broken.dot": b"digraph { this -> is -> { not valid !!!"})
        upload("graph-limit", {"large-graph.dot": b"digraph G { a -> b; }\n" + b"// padding\n" * 6000})
        upload("oversized", {"large.dot": b"digraph G { a -> b; }\n" + b"// padding\n" * 200000})
        upload("directory", {"index.html": b"<!doctype html><h1>Original directory index</h1>",
                             "docs/guide ü.md": MARKDOWN + b"\n![local asset](../assets/picture.png)\n", "assets/picture.png": png_fixture(),
                             "assets/data.bin": b"\x00raw\xff\r\n"}, kind="dir")
        upload("external", {"index.html": b"<h1>Protected directory index</h1>",
                            "docs/guide ü.md": MARKDOWN + b"\n![local asset](../assets/picture.png)\n", "assets/picture.png": png_fixture()},
               kind="dir", visibility="external")
        upload("internal", {"private.md": b"# Internal viewer handoff\n"}, visibility="internal")
        payload = {"base": fix.api_base, "token": fix.identity.token,
                   "core": core, "browser": browser, "mode": mode,
                   "resolver": bf.HOST_RESOLVER_RULES, "records": records,
                   "artifacts": str(Path(os.environ["MANURE_VIEWER_ARTIFACTS"]).resolve())
                   if os.environ.get("MANURE_VIEWER_ARTIFACTS") else ""}
        result = subprocess.run([node, str(Path(__file__).resolve().parent / "browser/viewers.mjs")],
                                input=json.dumps(payload).encode(), capture_output=True, timeout=300)
        output = (result.stdout + result.stderr).decode("utf-8", "replace")
        for secret in [fix.identity.token, records["external"]["external_password"]]:
            output = output.replace(secret, "[REDACTED]")
        self.assertEqual(result.returncode, 0, output[-12000:])
        report = json.loads(result.stdout)
        self.assertEqual(len(report), 8, report)
        self.assertTrue(all(item["ok"] for item in report), report)
        for item in report:
            print("ok - " + mode + " viewer: " + item["name"])

    def test_path_viewer_rendering_and_authorization(self):
        self.run_viewers("path")

    def test_subdomain_viewer_rendering_and_authorization(self):
        self.run_viewers("separate")
