"""Deterministic synthetic seed data for the UI capture harness.

Uploads through the real current API (same helper shape as
manure/tests/browser_fixtures.upload_fixture, extended with tags/provenance).
Nothing here is real data: every byte is generated from a fixed PRNG seed.
"""
from __future__ import annotations

import binascii
import hashlib
import io
import json
import random
import struct
import tarfile
import time
import types
import urllib.parse
import zipfile
import zlib

import browser_fixtures as bf

cp = bf.cp
RNG_SEED = 20261117
MIN_TTL_S = 60

# --------------------------------------------------------------------------
# synthetic file contents
# --------------------------------------------------------------------------

def png(width: int, height: int, rgb) -> bytes:
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", binascii.crc32(kind + data) & 0xffffffff)
    column = b"".join(bytes(((rgb[0] + x * 90 // width) % 256, (rgb[1] + x * 60 // width) % 256, rgb[2])) for x in range(width))
    rows = b"".join(b"\0" + bytes(((rgb[0] + y * 120 // height) % 256 ^ c) % 256 for c in column) for y in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def pdf(pages: int) -> bytes:
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", None]
    kids = []
    first_page = 4
    font = 3
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for number in range(pages):
        page_obj = first_page + number * 2
        kids.append(f"{page_obj} 0 R")
        objects.append(("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents "
                        + f"{page_obj + 1} 0 R >>").encode())
        stream = f"BT /F1 28 Tf 72 700 Td (Quarterly capacity review - page {number + 1}) Tj ET\nBT /F1 12 Tf 72 660 Td (Synthetic PDF for UI capture.) Tj ET\n".encode()
        objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream")
    objects[1] = ("<< /Type /Pages /Kids [" + " ".join(kids) + f"] /Count {pages} >>").encode()
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(out)
    out.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        out.extend(f"{offset:010} 00000 n \n".encode())
    out.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(out)


def zip_bytes(rng: random.Random, entries: int) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for index in range(entries):
            archive.writestr(f"logs/node-{index:03}.log", "".join(f"{rng.random():.6f} ok\n" for _ in range(200)))
    return buffer.getvalue()


def tgz_bytes(rng: random.Random, entries: int) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for index in range(entries):
            data = "".join(f"{rng.random():.6f} ok\n" for _ in range(300)).encode()
            info = tarfile.TarInfo(f"dump/part-{index:03}.txt"); info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


MARKDOWN_REPORT = """# Capacity review — 2026 Q4

Synthetic report used for UI capture. All figures are invented.

## Summary

| Cluster | GPUs | Utilisation | Notes |
| --- | ---: | ---: | --- |
| eu-north1-a | 4096 | 81% | steady |
| eu-west1-b | 2048 | 64% | maintenance window on 12 Dec |
| us-central1-c | 1024 | 92% | **over target** |

## Checklist

- [x] Collect utilisation exports
- [x] Reconcile with billing
- [ ] Review with capacity council

## Architecture

```mermaid
flowchart LR
    Ingest[Ingest] --> Store[(Object store)]
    Store --> Report[Report builder]
    Report --> Review{{Council review}}
```

## Snippet

```python
def utilisation(used: int, total: int) -> float:
    return used / total if total else 0.0
```

> Numbers are refreshed nightly; see the dashboard for live data.

### Links

[Section below](#appendix) · [External example](https://example.com/capacity)

## Appendix

Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. """ + "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. " * 12 + "\n"

README_BROWSE = """# Model evaluation bundle

Contents of this directory are listed above. This README is rendered by the viewer below the listing.

| File | Purpose |
| --- | --- |
| `metrics.json` | aggregate metrics |
| `samples/` | per-prompt samples |

Run `manure fetch <id> ./bundle` to download everything.
"""

STATIC_SITE_INDEX = ("<!doctype html><html><head><meta charset=utf-8><title>Static site</title>"
                     "<style>body{font:16px system-ui;margin:3rem auto;max-width:40rem}</style></head>"
                     "<body><h1>Static site artifact</h1><p>Served unchanged from its own origin.</p>"
                     "<p><a href=docs/guide.html>Guide</a></p></body></html>").encode()

CODE_PY = ("import json, sys\n\n\ndef main(path: str) -> int:\n    with open(path) as handle:\n"
           "        data = json.load(handle)\n    print(len(data))\n    return 0\n\n\nif __name__ == '__main__':\n"
           "    raise SystemExit(main(sys.argv[1]))\n").encode()

MERMAID = b"sequenceDiagram\n  participant U as User\n  participant M as Manure\n  U->>M: upload\n  M-->>U: link\n"
DOT = b'digraph deps { rankdir=LR; api -> storage; api -> auth; auth -> postgres; storage -> postgres; storage -> fs; }\n'
SVG = (b'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">'
       b'<rect width="480" height="270" fill="#e7eef6"/><circle cx="240" cy="135" r="90" fill="#245b88"/>'
       b'<text x="240" y="142" font-size="26" text-anchor="middle" fill="#fff" font-family="sans-serif">diagram</text></svg>')


# --------------------------------------------------------------------------
# upload helper
# --------------------------------------------------------------------------

def upload(fix, token: str, *, name: str, kind: str, visibility: str, files: dict[str, bytes],
           empty_dirs=(), expires_in_s=None, tags=(), hostname=None, project_path=None, finish=True) -> dict:
    http = fix.http
    auth = {"Authorization": f"Bearer {token}"}
    entries = [cp.ManifestEntry_File(path, len(files[path]), hashlib.sha256(files[path]).hexdigest()) for path in sorted(files)]
    entries += [cp.ManifestEntry_Directory(path) for path in sorted(empty_dirs)]
    command = cp.Command_InitUpload(name, cp.ArtifactKind.File if kind == "file" else cp.ArtifactKind.Directory,
                                    cp.Visibility(visibility.capitalize()), expires_in_s, entries, list(tags), hostname, project_path)
    res = http.current(fix.api_base, command, headers=auth)
    if res.status != 200:
        raise RuntimeError(f"init {name!r} failed: HTTP {res.status} {res.body[:200]!r}")
    init = res.json()
    artifact_id, chunk_bytes = init["artifact_id"], init["chunk_bytes"]
    if not finish:
        return init
    for path in sorted(files):
        blob = files[path]
        for offset in range(0, max(len(blob), 1), chunk_bytes):
            chunk = blob[offset:offset + chunk_bytes]
            if not chunk and offset == 0 and len(blob) != 0:
                break
            query = urllib.parse.urlencode({"path": path, "offset": offset})
            put = http.request("PUT", f"{fix.api_base}/api/current/artifacts/{artifact_id}/chunks?{query}", body=chunk,
                               content_type="application/octet-stream",
                               headers={**auth, "X-Chunk-Sha256": hashlib.sha256(chunk).hexdigest()})
            if put.status != 200:
                raise RuntimeError(f"chunk {name!r}:{path} failed: HTTP {put.status} {put.body[:200]!r}")
    pub = http.current(fix.api_base, cp.Command_FinishUpload(artifact_id), headers=auth)
    if pub.status != 200:
        raise RuntimeError(f"finish {name!r} failed: HTTP {pub.status} {pub.body[:200]!r}")
    return init


# --------------------------------------------------------------------------
# catalogue generation
# --------------------------------------------------------------------------

PROJECTS = ["trainer", "tokenizer", "eval-harness", "gpu-fleet", "billing-export", "data-pipeline", "inference-gateway",
            "capacity", "storage-gc", "docs-site", "network-probe", "scheduler"]
NOUNS = ["report", "summary", "benchmark", "profile", "trace", "dump", "snapshot", "results", "notes", "dashboard", "export",
         "postmortem", "plan", "diff", "audit", "metrics"]
LONG_TITLES = [
    "Quarterly capacity review for the north-european GPU fleet including per-tenant utilisation breakdown, reservation churn and projected shortfalls through 2027-Q3 (draft v7, reviewed)",
    "profiler-trace_rank0-of-4096_step-184200_nccl-allreduce-hang-investigation_with-stacks-and-timeline_final_FINAL_v2.json.gz",
    "Ünïcödé näme — 日本語のレポート — отчёт по инфраструктуре — 🚀 launch-readiness checklist",
]
HOSTILE = "<img src=x onerror=alert(1)> \"quoted\" & <b>bold</b> name.txt"
HOSTS = ["build-eu-04", "dev-vm-alice", "gpu-node-1137", "ci-runner-22", None, None, None]
TAGS = [["release", "reviewed"], ["nightly"], ["incident", "p1"], ["benchmark", "h200"], ["docs"], [], [], [], []]
SIZES_FILL = [200, 800, 3000, 9000, 40000, 120000, 700000, 2_400_000]


def build_corpus(rng: random.Random, count: int):
    """Yield dicts describing artifacts; deterministic for a fixed RNG."""
    kinds = ["md", "html", "png", "pdf", "json", "csv", "log", "py", "zip", "tgz", "svg", "mmd", "dot", "txt", "bin", "dir-site", "dir-browse", "dir-nested"]
    for index in range(count):
        kind = kinds[index % len(kinds)] if index < len(kinds) else rng.choice(kinds)
        project = rng.choice(PROJECTS)
        noun = rng.choice(NOUNS)
        base = f"{project}-{noun}-{rng.randrange(1000, 9999)}"
        yield {"index": index, "kind": kind, "base": base, "project": project}


def file_payload(rng: random.Random, kind: str, base: str):
    """Return (name, files-dict, artifact-kind, empty_dirs)."""
    fill = rng.choice(SIZES_FILL)
    def text(n):
        words = ["alpha", "beta", "gamma", "delta", "tensor", "shard", "epoch", "loss", "grad", "kernel", "ring", "mesh"]
        return " ".join(rng.choice(words) for _ in range(max(n // 6, 1))).encode()[:n]
    if kind == "md":
        return base + ".md", {base + ".md": ("# " + base + "\n\n").encode() + text(fill)}, "file", ()
    if kind == "html":
        return base + ".html", {base + ".html": b"<!doctype html><title>" + base.encode() + b"</title><h1>" + base.encode() + b"</h1><p>" + text(min(fill, 5000)) + b"</p>"}, "file", ()
    if kind == "png":
        return base + ".png", {base + ".png": png(rng.choice([160, 320, 640]), rng.choice([90, 180, 360]), (rng.randrange(256), rng.randrange(256), rng.randrange(256)))}, "file", ()
    if kind == "pdf":
        return base + ".pdf", {base + ".pdf": pdf(rng.choice([1, 2, 3]))}, "file", ()
    if kind == "json":
        return base + ".json", {base + ".json": json.dumps({"id": base, "samples": [rng.random() for _ in range(min(fill // 12, 5000))]}).encode()}, "file", ()
    if kind == "csv":
        return base + ".csv", {base + ".csv": ("t,value\n" + "".join(f"{i},{rng.random():.5f}\n" for i in range(min(fill // 10, 8000)))).encode()}, "file", ()
    if kind == "log":
        return base + ".log", {base + ".log": b"".join(b"2026-11-17T10:%02d:%02dZ INFO step ok\n" % (i // 60 % 60, i % 60) for i in range(min(fill // 40, 6000)))}, "file", ()
    if kind == "py":
        return base + ".py", {base + ".py": CODE_PY}, "file", ()
    if kind == "zip":
        return base + ".zip", {base + ".zip": zip_bytes(rng, rng.choice([2, 8, 20]))}, "file", ()
    if kind == "tgz":
        return base + ".tar.gz", {base + ".tar.gz": tgz_bytes(rng, rng.choice([2, 8, 20]))}, "file", ()
    if kind == "svg":
        return base + ".svg", {base + ".svg": SVG}, "file", ()
    if kind == "mmd":
        return base + ".mmd", {base + ".mmd": MERMAID}, "file", ()
    if kind == "dot":
        return base + ".dot", {base + ".dot": DOT}, "file", ()
    if kind == "txt":
        return base + ".txt", {base + ".txt": text(fill)}, "file", ()
    if kind == "bin":
        return base + ".bin", {base + ".bin": bytes(rng.getrandbits(8) for _ in range(min(fill, 60000)))}, "file", ()
    if kind == "dir-site":
        return base, {"index.html": STATIC_SITE_INDEX, "docs/guide.html": b"<h1>Guide</h1>", "assets/app.css": b"body{color:#245b88}"}, "dir", ()
    if kind == "dir-browse":
        files = {"README.md": README_BROWSE.encode(), "metrics.json": b'{"acc":0.91}', "samples/a.txt": text(500), "samples/b.txt": text(700)}
        return base, files, "dir", ("empty", "samples/empty-sub")
    if kind == "dir-nested":
        files = {f"shard-{i // 8:02}/part-{i:03}.bin": bytes(rng.getrandbits(8) for _ in range(rng.choice([64, 512, 4096]))) for i in range(rng.choice([12, 40, 90]))}
        return base, files, "dir", ()
    raise ValueError(kind)


def seed(fix, users: dict, count: int, log) -> dict:
    """Upload the corpus and the named showcase artifacts. Returns a manifest of ids by role."""
    rng = random.Random(RNG_SEED)
    owners = list(users)
    roles: dict[str, dict] = {}

    def as_user(user):
        return types.SimpleNamespace(http=fix.http, api_base=fix.api_base)

    def put(role, owner, **kwargs):
        init = upload(as_user(owner), users[owner]["token"], **kwargs)
        record = {"artifact_id": init["artifact_id"], "owner": owner, "name": kwargs["name"], "visibility": kwargs["visibility"],
                  "external_password": init.get("external_password")}
        if role:
            roles[role] = record
        return record

    # expired artifacts (the catalogue hides them unless expired:true); minimum server TTL is 60 s
    expire_at = time.monotonic() + MIN_TTL_S + 3
    [put(f"expired_{i}", owners[i % len(owners)], name=f"expired-scratch-{i}.txt", kind="file", visibility="internal",
                    files={"x.txt": b"gone"}, expires_in_s=MIN_TTL_S) for i in range(3)]

    # showcase artifacts first (named roles used by the browser scenes)
    put("md_report", "alice", name="capacity-review-2026q4.md", kind="file", visibility="public",
        files={"capacity-review-2026q4.md": MARKDOWN_REPORT.encode()}, tags=["release", "reviewed"], hostname="build-eu-04", project_path="/work/capacity")
    put("mermaid", "alice", name="upload-flow.mmd", kind="file", visibility="public", files={"upload-flow.mmd": MERMAID})
    put("dot", "alice", name="service-deps.dot", kind="file", visibility="public", files={"service-deps.dot": DOT})
    put("svg", "alice", name="architecture.svg", kind="file", visibility="public", files={"architecture.svg": SVG})
    put("png", "bob", name="gpu-utilisation.png", kind="file", visibility="public", files={"gpu-utilisation.png": png(1280, 720, (30, 100, 160))})
    put("pdf", "bob", name="capacity-review.pdf", kind="file", visibility="public", files={"capacity-review.pdf": pdf(3)})
    put("bad_dot", "bob", name="broken-graph.dot", kind="file", visibility="public", files={"broken-graph.dot": b"digraph { this -> is -> { not valid !!!"})
    put("code_py", "carol", name="summarise.py", kind="file", visibility="public", files={"summarise.py": CODE_PY})
    put("html_file", "carol", name="status-page.html", kind="file", visibility="public",
        files={"status-page.html": b"<!doctype html><title>Status</title><body style='font:16px sans-serif;margin:2rem'><h1>All systems nominal</h1></body>"})
    put("zip_file", "carol", name="logs-bundle.zip", kind="file", visibility="public", files={"logs-bundle.zip": zip_bytes(rng, 6)})
    put("site_dir", "alice", name="docs-site-preview", kind="dir", visibility="public",
        files={"index.html": STATIC_SITE_INDEX, "docs/guide.html": b"<h1>Guide</h1>"}, tags=["docs"], project_path="/work/docs-site")
    put("browse_dir", "bob", name="eval-bundle-2026-11-17", kind="dir", visibility="public",
        files={"README.md": README_BROWSE.encode(), "metrics.json": b'{"acc":0.91}', "samples/a.txt": b"sample a", "samples/b.txt": b"sample b",
               "notes/ü-ünïcode & <b>.md": b"# nested"},
        empty_dirs=("empty", "samples/empty-sub"), tags=["eval"], hostname="gpu-node-1137")
    put("internal_md", "alice", name="internal-handoff.md", kind="file", visibility="internal", files={"internal-handoff.md": b"# Internal handoff\n\nOnly authenticated users.\n"})
    put("internal_png", "alice", name="internal-chart.png", kind="file", visibility="internal", files={"internal-chart.png": png(640, 360, (160, 60, 40))})
    put("external_site", "alice", name="partner-share-bundle", kind="dir", visibility="external",
        files={"index.html": STATIC_SITE_INDEX, "docs/guide.html": b"<h1>Guide</h1>"}, tags=["partner"])
    put("external_md", "carol", name="partner-brief.md", kind="file", visibility="external", files={"partner-brief.md": b"# Partner brief\n\nPassword protected.\n"})
    big_files = {f"shard-{i // 20:02}/part-{i:03}.bin": bytes(rng.getrandbits(8) for _ in range(rng.choice([64, 1024, 8192]))) for i in range(160)}
    put("big_dir", "alice", name="checkpoint-shards-step-184200", kind="dir", visibility="internal", files=big_files, empty_dirs=("shard-99/empty",),
        tags=["checkpoint", "h200"], hostname="gpu-node-1137", project_path="/work/trainer/checkpoints")
    put("long_name", "bob", name=LONG_TITLES[0] + ".md", kind="file", visibility="external", files={"long.md": b"# long\n"},
        tags=["release", "reviewed", "quarterly", "capacity", "emea", "draft"], hostname="build-eu-04.region-a.internal.example", project_path="/work/trainer/some/very/deep/path/to/project/with/a/long/name/segments")
    put("long_name2", "carol", name=LONG_TITLES[1], kind="file", visibility="internal", files={"trace.json.gz": b"\x1f\x8b" + bytes(200)})
    put("unicode", "carol", name=LONG_TITLES[2], kind="file", visibility="public", files={"u.md": b"# u\n"})
    put("hostile", "bob", name=HOSTILE, kind="file", visibility="internal", files={"h.txt": b"x"})
    put("mutable", "alice", name="access-demo-notes.txt", kind="file", visibility="internal", files={"notes.txt": b"scratch notes for the access-mode demo\n"})
    put("deletable", "alice", name="delete-demo-scratch.txt", kind="file", visibility="internal", files={"d.txt": b"delete me\n"})
    put("ttl_week", "alice", name="short-lived-export.csv", kind="file", visibility="internal", files={"e.csv": b"a,b\n1,2\n"}, expires_in_s=7 * 86400)
    put("ttl_hour", "bob", name="one-hour-scratch.txt", kind="file", visibility="public", files={"s.txt": b"scratch"}, expires_in_s=3600)
    put("uploading", "alice", name="half-uploaded-dataset", kind="dir", visibility="internal", files={f"part-{i}.bin": bytes(2048) for i in range(5)}, finish=False)
    put("uploading2", "bob", name="another-incomplete-upload.tar.gz", kind="file", visibility="external", files={"a.tar.gz": bytes(4096)}, finish=False)
    # bulk corpus
    for item in build_corpus(rng, count):
        owner = rng.choice(owners)
        visibility = rng.choices(["internal", "external", "public"], weights=[55, 25, 20])[0]
        name, files, artifact_kind, empty = file_payload(rng, item["kind"], item["base"])
        if rng.random() < 0.04:
            name = rng.choice(LONG_TITLES) + f" #{item['index']}"
        expires = rng.choice([None, None, None, None, 86400, 7 * 86400, 30 * 86400, 90 * 86400])
        tags = rng.choice(TAGS)
        hostname = rng.choice(HOSTS)
        project_path = f"/work/{item['project']}" if rng.random() < 0.5 else None
        try:
            put(None, owner, name=name, kind=artifact_kind, visibility=visibility, files=files, empty_dirs=empty,
                expires_in_s=expires, tags=tags, hostname=hostname, project_path=project_path)
        except RuntimeError as error:
            log(f"seed skip {item['index']}: {error}")
        if item["index"] % 50 == 0:
            log(f"seeded {item['index']}/{count}")
    remaining = expire_at - time.monotonic()
    if remaining > 0:
        log(f"waiting {remaining:.0f}s for the short-TTL artifacts to expire")
        time.sleep(remaining)
    return roles
