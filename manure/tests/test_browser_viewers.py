"""Specified viewer contracts over real Chromium + owned server/PG/filesystem.

Behavioral-Active / Effectual / Good Communication: rendering and attempted
network side effects are observed through browser APIs, never mocked renderers.
Hyperlink navigation assertions also cover the external-href stripping regression.
"""
import base64
import binascii
import json
import math
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


WAV_RATE = 8000
WAV_SECONDS = 2


def wav_fixture():
    """Two seconds of a 440 Hz tone: 16-bit mono PCM in a RIFF container."""
    samples = b"".join(struct.pack("<h", round(8000 * math.sin(2 * math.pi * 440 * i / WAV_RATE))) for i in range(WAV_RATE * WAV_SECONDS))
    header = (b"RIFF" + struct.pack("<I", 36 + len(samples)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, WAV_RATE, WAV_RATE * 2, 2, 16)
              + b"data" + struct.pack("<I", len(samples)))
    return header + samples


def png_fixture():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", binascii.crc32(kind + data) & 0xffffffff)
    # Larger than the viewport so Fit and Zoom must have observable effects.
    pixels = (b"\0" + b"\x20\x80\xc0" * 1600) * 900
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1600, 900, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b""))


def cast_fixture(version):
    """The same timeline in v2 (absolute seconds) and v3 (delta seconds)."""
    if version == 2:
        header = {"version": 2, "width": 72, "height": 12}
        times = (0, 1.25, 28, 66)
    else:
        header = {"version": 3, "term": {"cols": 48, "rows": 100}}
        times = (0, 1.25, 26.75, 38)
    header["audioUrl"] = "https://viewer-attacker.invalid/recording.wav"
    output = ("\x1b[32mTerminal <b>literal</b>\x1b[0m\r\n", "Playback advanced\r\n",
              "After seek\r\n", "Recording complete\r\n")
    events = [[time, "o", text] for time, text in zip(times, output)]
    return "".join(json.dumps(line) + "\n" for line in [header, *events]).encode()


MARKDOWN = b'''# Viewer specification

## Uploaded at

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
<span data-icon="box" class='x"><img src="https://viewer-attacker.invalid/hydrate.png" onerror="window.__viewerExecuted = true">'>Authored icon placeholder</span>
[unsafe](javascript:window.__viewerExecuted=true)
![remote](https://viewer-attacker.invalid/remote.png)

[!182749](https://example.com/review/182749)
[HTTP review](http://example.com/review/182749)
[Protocol-relative review](//example.com/review/182749)
[Local review](./related.md?view=1#topic)
[Encoded resource](./CPU%2090%25.md)
[Jump to title](#viewer-specification)
<a href="https://example.com/raw?left=1&amp;right=2" rel="opener" ping="https://viewer-attacker.invalid/ping" referrerpolicy="unsafe-url" onclick="window.__viewerExecuted=true">Raw review</a>

<a href="jav&#x61;script:window.__viewerExecuted=true">Entity script scheme</a>
<a href="jav&#x09;ascript:window.__viewerExecuted=true">Tab script scheme</a>
<a href="java&#x0d;&#x0a;script:window.__viewerExecuted=true">Line script scheme</a>
<a href="data:text/html,unsafe">Data scheme</a>
<a href="vbscript:unsafe">Legacy script scheme</a>
<a href="file:///tmp/unsafe">Local file scheme</a>
<a href="blob:https://example.com/unsafe">Blob scheme</a>
<a href="mailto:review@example.com">Mail scheme</a>
<a href="https://user:pass@example.com/review">Credential URL</a>
<a href="https://exa&#x09;mple.com/review">Control URL</a>
<a href="http://[broken">Malformed URL</a>
<a href="/__manure/logout">Reserved route</a>
<a href="/api/users">Management route</a>
<a href="../%5f%5fmanure/logout">Encoded reserved route</a>
<a href="../%61pi/users">Encoded management route</a>
<a href="../%2fapi/users">Encoded slash path</a>
<a href="../%5capi/users">Encoded backslash path</a>
<a href="../bad%00name">Encoded null path</a>
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

        def upload(key, files, *, visibility="public", kind="file", empty_dirs=None):
            record = bf.upload_fixture(fix, name="viewer-" + key, kind=kind,
                                       visibility=visibility, files=files, empty_dirs=empty_dirs)
            record["content_url"] = bf.content_url_for(fix, record["artifact_id"])
            info = fix.http.current(fix.api_base, bf.cp.Command_GetArtifact(record["artifact_id"]),
                                    headers={"Authorization": f"Bearer {fix.identity.token}"})
            self.assertEqual(info.status, 200)
            record["created_at"] = info.json()["created_at"]
            # Password/token only transit stdin; never argv or browser artifacts.
            record["files"] = {name: base64.b64encode(blob).decode() for name, blob in files.items()}
            records[key] = record

        upload("sibling", {"README.md": b"# Sibling artifact destination\n\n## 7 Limits\n",
                           "docs/guide.html": b"<!doctype html><h1 id=topic>Sibling subpath destination</h1>",
                           "image.png": png_fixture()}, kind="dir")
        sibling = records["sibling"]["content_url"].rstrip("/")
        markdown = MARKDOWN + (f'\n<a href="{fix.api_base}/api/users">Absolute management route</a>\n'
                               f'<a href="{fix.api_base}/__manure/logout">Absolute reserved route</a>\n'
                               f'<a href="{fix.api_base}/view/other/README.md">Absolute sibling mount</a>\n'
                               f'\n{sibling}\n\n[Sibling entry]({sibling})\n\n[Sibling slash]({sibling}/)\n'
                               f'\n[Sibling section]({sibling}/#7-limits)\n'
                               f'\n[Sibling subpath]({sibling}/docs/guide.html#topic)\n'
                               f'\n<a href="{sibling}">Raw sibling</a>\n'
                               f'\n![Sibling image]({sibling}/image.png)\n').encode()
        if mode == "path":
            markdown += f'\n[Rooted sibling](/view/{records["sibling"]["artifact_id"]})\n'.encode()
        upload("markdown", {"guide ü.md": markdown})
        upload("mermaid", {"flow.mmd": b"flowchart LR\n A[Start] --> B[Finish]\n"})
        upload("dot", {"graph.dot": b"digraph G { alpha -> beta; }\n"})
        upload("svg", {"drawing.svg": SVG})
        upload("png", {"picture.png": png_fixture()})
        upload("pdf", {"document.pdf": two_page_pdf()})
        cast_v2 = cast_fixture(2)
        upload("cast", {"recording.cast": cast_v2})
        upload("malformed", {"broken.dot": b"digraph { this -> is -> { not valid !!!"})
        upload("graph-limit", {"large-graph.dot": b"digraph G { a -> b; }\n" + b"// padding\n" * 6000})
        upload("oversized", {"large.dot": b"digraph G { a -> b; }\n" + b"// padding\n" * 200000})
        upload("directory", {"index.html": b"<!doctype html><h1>Original directory index</h1>",
                             "docs/guide ü.md": markdown + b"\n![local asset](../assets/picture.png)\n", "assets/picture.png": png_fixture(),
                             "assets/data.bin": b"\x00raw\xff\r\n"}, kind="dir")
        upload("browse", {"README.md": markdown,
                          "nested/readme.md": b"# Nested directory preview\n",
                          "nested/a & <b> + ü.md": b"# Encoded child preview\n",
                          "original.bin": b"\x00original\xff"}, kind="dir", empty_dirs=["empty"])
        upload("external", {"index.html": b"<h1>Protected directory index</h1>",
                            "docs/guide ü.md": markdown + b"\n![local asset](../assets/picture.png)\n", "assets/picture.png": png_fixture(),
                            "docs/protected.cast": cast_fixture(3)},
               kind="dir", visibility="external")
        upload("internal", {"private.md": b"# Internal viewer handoff\n"}, visibility="internal")
        upload("code", {"tool.py": b"print('hi')\n# done\n"})
        upload("archive", {"bundle.zip": b"PK\x05\x06" + bytes(18)})
        upload("formats", {
            "src/summarise.py": b'import json\n\n\ndef load(path):\n    """Doc\n    string."""\n    return json.loads(path)  # <b>text</b>\n',
            "fix.diff": b"diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n",
            "metrics.json": b'{"run":"m4","big":12345678901234567890,"rows":[1.50,null]}',
            "results.csv": b'name,score,note\r\nalpha,1.50,"said ""hi"", twice"\r\nbeta,-2,\r\n',
            "build.log": b"\x1b[2m06:02\x1b[0m \x1b[32mok\x1b[0m\n\x1b[1;31merror\x1b[0m at <x>\n",
            "crawl.log": (b"x" * 98 + "\u00e9\n".encode()) * 26000,
            "big.csv": b"id,note\n" + b"".join(b"%d,%s\n" % (n, b"cell " * 20) for n in range(1, 22001)),
            "Makefile": b"all: dist\n\tnpm run build\n",
            "notes.md": b"# Notes\n\n```python\ndef f():\n    return 1\n```\n",
            "model.bin": b"\x00\x01binary\xff",
            "tone.wav": wav_fixture(),
            "broken.mp4": b"not a video",
            "broken.cast": cast_v2 + b"malformed event\n",
            # Pad valid JSON whitespace rather than making an enormous output event.
            "large.cast": cast_v2.replace(b"\n", b" " * (2 * 1024 * 1024) + b"\n", 1)}, kind="dir")
        upload("unknown", {"model.safetensors": b"\x7fELF\x00\x01binary\xff"})
        upload("unlock-states", {"index.html": b"<h1>Unlock states</h1>"}, kind="dir", visibility="external")
        upload("unlock-gone", {"index.html": b"<h1>Deleted while locked</h1>"}, kind="dir", visibility="external")
        payload = {"base": fix.api_base, "token": fix.identity.token, "login": fix.identity.login, "loginPassword": fix.identity.password,
                   "core": core, "browser": browser, "mode": mode,
                   "resolver": bf.HOST_RESOLVER_RULES, "records": records}
        result = subprocess.run([node, str(Path(__file__).resolve().parent / "browser/viewers.mjs")],
                                input=json.dumps(payload).encode(), capture_output=True, timeout=300)
        output = (result.stdout + result.stderr).decode("utf-8", "replace")
        for secret in [fix.identity.token] + [record["external_password"] for record in records.values() if record.get("external_password")]:
            output = output.replace(secret, "[REDACTED]")
        self.assertEqual(result.returncode, 0, output[-12000:])
        report = json.loads(result.stdout)
        self.assertEqual(len(report), 19, report)
        self.assertTrue(all(item["ok"] for item in report), report)
        for item in report:
            print("ok - " + mode + " viewer: " + item["name"])

    def test_path_viewer_rendering_and_authorization(self):
        self.run_viewers("path")

    def test_subdomain_viewer_rendering_and_authorization(self):
        self.run_viewers("separate")
