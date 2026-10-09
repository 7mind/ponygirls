"""F1/F2/F2b/F6/F7/F8/F8b lifecycle behavioral spec (server agent owned).

Fixture for client/UI teams (same in all test_server_* files):
    config = ServerConfig.from_dict({
        "data_dir": str(tmp_path), "port": 0,
        "api_origin": "http://127.0.0.1:0",          # :0 -> bound port
        "content_suffix": "artifacts.localhost",
        "loopback_dev": True, "dashboard_dir": None,
        "unlock_shell_dir": None,                    # built-in unlock form
        "users": [{"id": "u1", "type": "agent",
                   "tokens": [{"id": "t1", "hashFile": hashfile}]}],
        ...overrides...
    })
    with create_server(config) as server:             # real loopback HTTP
        api_origin = server.effective_api_origin      # build Host/Origin here
        content_origin = server.content_url(aid)      # per-artifact origin
Content hosts are reached by opening 127.0.0.1:port with an explicit
``Host: <aid>.artifacts.localhost:<port>`` header (no DNS/hosts edits).
Optional private clock injection (tests only):
    clock = [time.time()]
    server = create_server(config, _now=lambda: clock[0])
"""

import hashlib
import http.client
import json
import os
import tempfile
import time
import unittest
import urllib.parse

from manure import auth as authmod
from manure.server import ServerConfig, create_server


# ---------------------------------------------------------------- helpers

def _write_hashfile(tmpdir, digest):
    path = os.path.join(tmpdir, "tok-%s.hash" % digest[:12])
    with open(path, "w", encoding="ascii") as fh:
        fh.write(digest + "\n")
    return path


def _mint_user(tmpdir, uid="u1", tid="t1", utype="agent"):
    token = authmod.generate_token()
    digest = authmod.sha256_hex(token)
    users = [{"id": uid, "type": utype,
              "tokens": [{"id": tid, "hashFile": _write_hashfile(tmpdir, digest)}]}]
    return users, token


def _make_config(tmpdir, users, **overrides):
    cfg = {
        "data_dir": os.path.join(tmpdir, "data"),
        "port": 0,
        "api_origin": "http://127.0.0.1:0",
        "content_suffix": "artifacts.localhost",
        "loopback_dev": True,
        "dashboard_dir": None,
        "unlock_shell_dir": None,
        "users": users,
    }
    cfg.update(overrides)
    return ServerConfig.from_dict(cfg)


class _Http:
    """Minimal stdlib HTTP client with explicit Host headers (no client dep)."""

    def __init__(self, port, api_origin):
        self.port = port
        self.api_origin = api_origin
        self.api_host = urllib.parse.urlsplit(api_origin).netloc

    def request(self, method, path, host, body=None, ctype=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        conn.putrequest(method, path, skip_host=True)
        conn.putheader("Host", host)
        h = dict(headers or {})
        if body is not None and ctype:
            h["Content-Type"] = ctype
        if body is not None:
            h["Content-Length"] = str(len(body))
        for k, v in h.items():
            conn.putheader(k, v)
        conn.endheaders(body)
        resp = conn.getresponse()
        data = resp.read()
        out_headers = dict(resp.getheaders())
        status = resp.status
        conn.close()
        return status, out_headers, data

    def api(self, method, path, token=None, origin="present", **kw):
        headers = dict(kw.pop("headers", {}) or {})
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        if origin == "present":
            headers["Origin"] = self.api_origin
        elif origin is not None:
            headers["Origin"] = origin
        return self.request(method, path, self.api_host, headers=headers, **kw)

    def content(self, artifact_id, method, path, **kw):
        host = "%s.artifacts.localhost:%d" % (artifact_id, self.port)
        return self.request(method, path, host, **kw)

    @staticmethod
    def json_body(obj):
        return json.dumps(obj).encode(), "application/json"


def _init_artifact(http, token, name="n", kind="file", visibility="internal",
                   files=None, **extra):
    if files is None:
        files = [{"path": "f.bin", "kind": "file", "size": 3,
                  "sha256": hashlib.sha256(b"abc").hexdigest()}]
    payload = {"name": name, "kind": kind, "visibility": visibility,
               "files": files}
    payload.update(extra)
    body, ctype = _Http.json_body(payload)
    return http.api("POST", "/api/v1/artifacts:init", token, body=body, ctype=ctype)


def _put_chunk(http, token, aid, path, offset, data):
    qp = "/api/v1/artifacts/%s/chunks?path=%s&offset=%d" % (
        aid, urllib.parse.quote(path, safe=""), offset)
    headers = {"X-Chunk-Sha256": hashlib.sha256(data).hexdigest()}
    return http.api("PUT", qp, token, body=data,
                    ctype="application/octet-stream", headers=headers)


def _upload_all(http, token, aid, blobs):
    """blobs: {path: bytes}; uploads each in one chunk + publishes."""
    for path, data in blobs.items():
        st, _, raw = _put_chunk(http, token, aid, path, 0, data)
        assert st == 200, (st, raw[:300])
    body, ctype = _Http.json_body({})
    return http.api("POST", "/api/v1/artifacts/%s/publish" % aid, token,
                    body=body, ctype=ctype)


class LifecycleCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.users, self.token = _mint_user(self.tmp.name)
        self.server = create_server(_make_config(self.tmp.name, self.users))
        self.addCleanup(lambda: self.server.close())
        self.http = _Http(self.server.bound_port, self.server.effective_api_origin)

    # -- F1 ------------------------------------------------------------
    def test_f1_file_roundtrip_bytes_and_sha(self):
        data = b"hello-manure-" * 5000
        files = [{"path": "f.bin", "kind": "file", "size": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}]
        st, _, raw = _init_artifact(self.http, self.token, files=files)
        self.assertEqual(st, 200, raw[:300])
        aid = json.loads(raw)["artifact_id"]
        self.assertRegex(aid, r"^[0-9a-f]{32}$")
        st, _, raw = _put_chunk(self.http, self.token, aid, "f.bin", 0, data)
        self.assertEqual(st, 200, raw[:300])
        ack = json.loads(raw)
        self.assertEqual(ack["received_bytes"], len(data))
        body, ctype = _Http.json_body({})
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.token, body=body, ctype=ctype)
        self.assertEqual(st, 200, raw[:300])
        # API byte download identical
        st, hdrs, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % aid, self.token,
            origin=None)
        self.assertEqual(st, 200, (st, got[:200]))
        self.assertEqual(got, data)
        self.assertEqual(hdrs.get("Accept-Ranges"), "bytes")
        # Range 206 + Content-Range
        st, hdrs, part = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % aid, self.token,
            origin=None, headers={"Range": "bytes=0-3"})
        self.assertEqual(st, 206, (st, part[:200]))
        self.assertEqual(part, data[0:4])
        self.assertIn("Content-Range", hdrs)
        # Unsatisfiable -> 416
        st, _, _ = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % aid, self.token,
            origin=None,
            headers={"Range": "bytes=%d-%d" % (len(data) + 9, len(data) + 99)})
        self.assertEqual(st, 416)

    # -- F2 ------------------------------------------------------------
    def test_f2_dir_empty_dirs_index_and_manifest_json(self):
        idx = b"<html>idx</html>"
        mf = b'{"user": true}'
        files = [
            {"path": "index.html", "kind": "file", "size": len(idx),
             "sha256": hashlib.sha256(idx).hexdigest()},
            {"path": "assets", "kind": "dir"},
            {"path": "manifest.json", "kind": "file", "size": len(mf),
             "sha256": hashlib.sha256(mf).hexdigest()},
        ]
        st, _, raw = _init_artifact(self.http, self.token, kind="dir",
                                    files=files, name="site")
        self.assertEqual(st, 200, raw[:300])
        aid = json.loads(raw)["artifact_id"]
        st, _, raw = _upload_all(self.http, self.token, aid,
                                 {"index.html": idx, "manifest.json": mf})
        self.assertEqual(st, 200, raw[:300])
        # API files listing carries hashes for files, path+kind only for dirs
        st, _, raw = self.http.api("GET", "/api/v1/artifacts/%s/files" % aid,
                                   self.token, origin=None)
        self.assertEqual(st, 200)
        listing = json.loads(raw)["files"]
        by_path = {e["path"]: e for e in listing}
        self.assertIn("sha256", by_path["index.html"])
        self.assertEqual(set(by_path["assets"].keys()), {"path", "kind"})
        # one-time grant handoff -> content cookie -> GET / serves index
        body, ctype = _Http.json_body({})
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/grants" % aid,
                                   self.token, body=body, ctype=ctype)
        self.assertEqual(st, 200, raw[:300])
        grant = json.loads(raw)["grant"]
        gbody = urllib.parse.urlencode({"grant": grant}).encode()
        st, hdrs, _ = self.http.content(
            aid, "POST", "/__manure/grant", body=gbody,
            ctype="application/x-www-form-urlencoded",
            headers={"Origin": self.http.api_origin})
        self.assertEqual(st, 303, (st, hdrs))
        cookie = hdrs.get("Set-Cookie", "")
        self.assertIn("mgrant-dev=", cookie)
        grant_cookie = cookie.split(";", 1)[0]
        st, _, got = self.http.content(
            aid, "GET", "/", headers={"Cookie": grant_cookie})
        self.assertEqual(st, 200, (st, got[:200]))
        self.assertEqual(got, idx)
        # manifest.json served as a plain user file
        st, _, got = self.http.content(
            aid, "GET", "/manifest.json", headers={"Cookie": grant_cookie})
        self.assertEqual(st, 200)
        self.assertEqual(got, mf)
        # dir without index -> 404, never a listing
        idx2 = b"x"
        files2 = [{"path": "a.txt", "kind": "file", "size": 1,
                   "sha256": hashlib.sha256(idx2).hexdigest()}]
        st, _, raw = _init_artifact(self.http, self.token, kind="dir",
                                    files=files2)
        aid2 = json.loads(raw)["artifact_id"]
        _upload_all(self.http, self.token, aid2, {"a.txt": idx2})
        body, ctype = _Http.json_body({})
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/grants" % aid2,
                                   self.token, body=body, ctype=ctype)
        grant2 = json.loads(raw)["grant"]
        gbody = urllib.parse.urlencode({"grant": grant2}).encode()
        st, hdrs, _ = self.http.content(
            aid2, "POST", "/__manure/grant", body=gbody,
            ctype="application/x-www-form-urlencoded",
            headers={"Origin": self.http.api_origin})
        cookie2 = hdrs.get("Set-Cookie", "").split(";", 1)[0]
        st, _, got = self.http.content(
            aid2, "GET", "/", headers={"Cookie": cookie2})
        self.assertEqual(st, 404)

    # -- F2b -----------------------------------------------------------
    def test_f2b_topology_rejections(self):
        good_sha = hashlib.sha256(b"z").hexdigest()

        def init(files, kind="dir"):
            return _init_artifact(self.http, self.token, kind=kind, files=files)

        # duplicate paths
        st, _, raw = init([{"path": "a", "kind": "file", "size": 1,
                            "sha256": good_sha}] * 1 + [
                           {"path": "a", "kind": "dir"}])
        self.assertEqual(st, 400)
        self.assertIn(json.loads(raw)["error"]["code"],
                      ("invalid-manifest", "invalid-path"))
        # file/descendant conflict
        st, _, _ = init([{"path": "a", "kind": "file", "size": 1,
                          "sha256": good_sha},
                         {"path": "a/b", "kind": "file", "size": 1,
                          "sha256": good_sha}])
        self.assertEqual(st, 400)
        # reserved prefixes
        for reserved in ("__manure/x", "__manure", "api/v1", "api"):
            st, _, raw = init([{"path": reserved, "kind": "file", "size": 1,
                                "sha256": good_sha}])
            self.assertEqual(st, 400, reserved)
            self.assertEqual(json.loads(raw)["error"]["code"], "invalid-path")
        # kind=file must hold exactly one file
        st, _, _ = init([{"path": "a", "kind": "file", "size": 1,
                          "sha256": good_sha}], kind="file")
        # single file ok covered by F1; two files with kind=file rejected
        st, _, _ = init([{"path": "a", "kind": "file", "size": 1,
                          "sha256": good_sha},
                         {"path": "b", "kind": "file", "size": 1,
                          "sha256": good_sha}], kind="file")
        self.assertEqual(st, 400)
        # empty-root dir artifact accepted
        st, _, raw = init([], kind="dir")
        self.assertEqual(st, 200, raw[:200])
        # single-file artifact serves / and /<name> on content host (public)
        data = b"one"
        st, _, raw = _init_artifact(
            self.http, self.token, kind="file", visibility="public",
            files=[{"path": "one.txt", "kind": "file", "size": 3,
                    "sha256": hashlib.sha256(data).hexdigest()}])
        aid = json.loads(raw)["artifact_id"]
        _upload_all(self.http, self.token, aid, {"one.txt": data})
        st, _, got = self.http.content(aid, "GET", "/")
        self.assertEqual(st, 200)
        self.assertEqual(got, data)
        st, _, got = self.http.content(aid, "GET", "/one.txt")
        self.assertEqual(st, 200)
        self.assertEqual(got, data)
        # encoded traversal rejected
        st, _, raw = self.http.content(aid, "GET", "/%2e%2e/secret")
        self.assertEqual(st, 400)
        self.assertEqual(json.loads(raw)["error"]["code"], "invalid-path")
        st, _, _ = self.http.content(aid, "GET", "/a%2Fb")
        self.assertIn(st, (400, 404))

    # -- F6 ------------------------------------------------------------
    def test_f6_resume_status_idempotent_conflict(self):
        # multi-chunk file on the minimum 256 KiB chunk_bytes grid
        self.server.close()
        self.server = create_server(_make_config(
            self.tmp.name, self.users, chunk_bytes=262144))
        self.http = _Http(self.server.bound_port,
                          self.server.effective_api_origin)
        chunk = 262144
        size = 2 * chunk + 75712
        data = bytes(i % 251 for i in range(size))
        files = [{"path": "big.bin", "kind": "file", "size": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}]
        st, _, raw = _init_artifact(self.http, self.token, files=files)
        aid = json.loads(raw)["artifact_id"]
        half = chunk
        st, _, raw = _put_chunk(self.http, self.token, aid, "big.bin", 0,
                                data[:half])
        self.assertEqual(st, 200)
        # status shows received ranges
        st, _, raw = self.http.api(
            "GET", "/api/v1/artifacts/%s/upload-status" % aid, self.token,
            origin=None)
        self.assertEqual(st, 200)
        status = json.loads(raw)
        self.assertEqual(status["files"][0]["received_bytes"], half)
        self.assertEqual(status["files"][0]["received_ranges"], [[0, half]])
        # duplicate identical chunk -> 200 no-op
        st, _, _ = _put_chunk(self.http, self.token, aid, "big.bin", 0,
                              data[:half])
        self.assertEqual(st, 200)
        # conflicting bytes at same offset -> 409
        other = b"Z" * half
        qp = "/api/v1/artifacts/%s/chunks?path=%s&offset=0" % (
            aid, urllib.parse.quote("big.bin", safe=""))
        headers = {"X-Chunk-Sha256": hashlib.sha256(other).hexdigest()}
        st, _, raw = self.http.api("PUT", qp, self.token, body=other,
                                   ctype="application/octet-stream",
                                   headers=headers)
        self.assertEqual(st, 409)
        self.assertEqual(json.loads(raw)["error"]["code"], "chunk-conflict")
        # restart server on same data_dir -> resumable, unacked resend safe
        self.server.close()
        self.server = create_server(_make_config(
            self.tmp.name, self.users, chunk_bytes=262144))
        self.http = _Http(self.server.bound_port,
                          self.server.effective_api_origin)
        st, _, raw = self.http.api(
            "GET", "/api/v1/artifacts/%s/upload-status" % aid, self.token,
            origin=None)
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(raw)["files"][0]["received_bytes"], half)
        st, _, _ = _put_chunk(self.http, self.token, aid, "big.bin", half,
                              data[half:2 * chunk])
        self.assertEqual(st, 200)
        st, _, _ = _put_chunk(self.http, self.token, aid, "big.bin",
                              2 * chunk, data[2 * chunk:])
        self.assertEqual(st, 200)
        body, ctype = _Http.json_body({})
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.token, body=body, ctype=ctype)
        self.assertEqual(st, 200, raw[:300])

    # -- R1 out-of-order / concurrent / fault-injected chunks ------------
    def _chunked_server(self, chunk=262144):
        self.server.close()
        self.server = create_server(_make_config(
            self.tmp.name, self.users, chunk_bytes=chunk))
        self.http = _Http(self.server.bound_port,
                          self.server.effective_api_origin)
        return chunk

    def _init_sized(self, size, chunk):
        data = bytes(i % 251 for i in range(size))
        files = [{"path": "big.bin", "kind": "file", "size": size,
                  "sha256": hashlib.sha256(data).hexdigest()}]
        st, _, raw = _init_artifact(self.http, self.token, files=files)
        self.assertEqual(st, 200, raw[:200])
        return json.loads(raw)["artifact_id"], data

    def test_r1_reverse_order_chunks_publish(self):
        chunk = self._chunked_server()
        aid, data = self._init_sized(2 * chunk + 100, chunk)
        # send tail first, then head: positional writes must land exactly
        st, _, _ = _put_chunk(self.http, self.token, aid, "big.bin",
                              2 * chunk, data[2 * chunk:])
        self.assertEqual(st, 200)
        st, _, _ = _put_chunk(self.http, self.token, aid, "big.bin",
                              chunk, data[chunk:2 * chunk])
        self.assertEqual(st, 200)
        st, _, _ = _put_chunk(self.http, self.token, aid, "big.bin",
                              0, data[:chunk])
        self.assertEqual(st, 200)
        body, ctype = _Http.json_body({})
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.token, body=body, ctype=ctype)
        self.assertEqual(st, 200, raw[:300])
        st, _, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/big.bin/content" % aid,
            self.token, origin=None)
        self.assertEqual(st, 200)
        self.assertEqual(hashlib.sha256(got).hexdigest(),
                         hashlib.sha256(data).hexdigest())

    def test_r1_concurrent_chunks_publish(self):
        import threading
        chunk = self._chunked_server()
        aid, data = self._init_sized(3 * chunk + 50, chunk)
        ranges = [(0, chunk), (chunk, 2 * chunk), (2 * chunk, 3 * chunk),
                  (3 * chunk, len(data))]
        barrier = threading.Barrier(len(ranges))
        failures = []

        def worker(off, end):
            try:
                barrier.wait(timeout=15)
                st, _, raw = _put_chunk(self.http, self.token, aid,
                                        "big.bin", off, data[off:end])
                if st != 200:
                    failures.append((off, st, raw[:200]))
            except Exception as exc:  # noqa: BLE001
                failures.append((off, exc))

        threads = [threading.Thread(target=worker, args=r) for r in ranges]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(failures, [])
        body, ctype = _Http.json_body({})
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.token, body=body, ctype=ctype)
        self.assertEqual(st, 200, raw[:300])
        st, _, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/big.bin/content" % aid,
            self.token, origin=None)
        self.assertEqual(got, data)

    def test_r1_restart_with_corrupted_bytes_resumes(self):
        chunk = self._chunked_server()
        aid, data = self._init_sized(2 * chunk + 100, chunk)
        _put_chunk(self.http, self.token, aid, "big.bin", 0, data[:chunk])
        _put_chunk(self.http, self.token, aid, "big.bin", chunk,
                   data[chunk:2 * chunk])
        _put_chunk(self.http, self.token, aid, "big.bin", 2 * chunk,
                   data[2 * chunk:])
        # corrupt receipt-backed bytes behind the store's back
        tree_path = os.path.join(self.tmp.name, "data", "staging", aid,
                                 "tree", "big.bin")
        with open(tree_path, "r+b") as fh:
            fh.seek(10)
            fh.write(b"CORRUPT")
        self.server.close()
        self.server = create_server(_make_config(
            self.tmp.name, self.users, chunk_bytes=chunk))
        self.http = _Http(self.server.bound_port,
                          self.server.effective_api_origin)
        st, _, raw = self.http.api(
            "GET", "/api/v1/artifacts/%s/upload-status" % aid, self.token,
            origin=None)
        self.assertEqual(st, 200)
        status = json.loads(raw)
        # corrupted first chunk dropped; intact later chunks kept
        self.assertEqual(status["files"][0]["received_ranges"],
                         [[chunk, len(data)]])
        st, _, _ = _put_chunk(self.http, self.token, aid, "big.bin", 0,
                              data[:chunk])
        self.assertEqual(st, 200)
        body, ctype = _Http.json_body({})
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.token, body=body, ctype=ctype)
        self.assertEqual(st, 200, raw[:300])
        st, _, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/big.bin/content" % aid,
            self.token, origin=None)
        self.assertEqual(got, data)

    # -- R6 bounded range streaming ----------------------------------------
    def test_r6_tiny_range_never_reads_whole_file(self):
        from unittest import mock
        chunk = 1048576
        size = 6 * chunk
        data = bytes(i % 251 for i in range(size))
        files = [{"path": "big.bin", "kind": "file", "size": size,
                  "sha256": hashlib.sha256(data).hexdigest()}]
        st, _, raw = _init_artifact(self.http, self.token, files=files)
        aid = json.loads(raw)["artifact_id"]
        for off in range(0, size, chunk):
            st, _, raw = _put_chunk(self.http, self.token, aid, "big.bin",
                                    off, data[off:off + chunk])
            self.assertEqual(st, 200, raw[:200])
        body, ctype = _Http.json_body({})
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.token, body=body, ctype=ctype)
        self.assertEqual(st, 200)
        real_pread = os.pread
        reads = []

        def counting(fd, length, offset):
            reads.append(length)
            return real_pread(fd, length, offset)
        with mock.patch("os.pread", side_effect=counting):
            st, hdrs, part = self.http.api(
                "GET", "/api/v1/artifacts/%s/files/big.bin/content" % aid,
                self.token, origin=None, headers={"Range": "bytes=0-0"})
        self.assertEqual(st, 206)
        self.assertEqual(part, data[0:1])
        self.assertTrue(reads, "expected at least one bounded read")
        self.assertLessEqual(max(reads), 65536)
        self.assertLessEqual(sum(reads), 65536)
        self.assertEqual(hdrs.get("Accept-Ranges"), "bytes")
        # full download still streams correctly
        st, _, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/big.bin/content" % aid,
            self.token, origin=None)
        self.assertEqual(st, 200)
        self.assertEqual(got, data)

    def test_r6_concurrent_ranged_downloads(self):
        import threading
        chunk = 1048576
        size = 2 * chunk
        data = bytes(i % 251 for i in range(size))
        files = [{"path": "big.bin", "kind": "file", "size": size,
                  "sha256": hashlib.sha256(data).hexdigest()}]
        st, _, raw = _init_artifact(self.http, self.token, files=files)
        aid = json.loads(raw)["artifact_id"]
        for off in range(0, size, chunk):
            _put_chunk(self.http, self.token, aid, "big.bin", off,
                       data[off:off + chunk])
        body, ctype = _Http.json_body({})
        self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                      self.token, body=body, ctype=ctype)
        failures = []

        def worker(i):
            try:
                start = i * 1000
                st, _, part = self.http.api(
                    "GET", "/api/v1/artifacts/%s/files/big.bin/content" % aid,
                    self.token, origin=None,
                    headers={"Range": "bytes=%d-%d" % (start, start + 999)})
                if st != 206 or part != data[start:start + 1000]:
                    failures.append((i, st))
            except Exception as exc:  # noqa: BLE001
                failures.append((i, exc))

        threads = [threading.Thread(target=worker, args=(i,))
                   for i in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(failures, [])

    # -- R11 lost-P5 over HTTP -----------------------------------------------
    def test_r11_http_fault_retry_download_verifies(self):
        chunk = 262144
        self._chunked_server(chunk)
        size = chunk + 10
        data = bytes(i % 251 for i in range(size))
        files = [{"path": "big.bin", "kind": "file", "size": size,
                  "sha256": hashlib.sha256(data).hexdigest()}]
        st, _, raw = _init_artifact(self.http, self.token, files=files)
        aid = json.loads(raw)["artifact_id"]
        _put_chunk(self.http, self.token, aid, "big.bin", 0, data[:chunk])
        _put_chunk(self.http, self.token, aid, "big.bin", chunk,
                   data[chunk:])
        self.server._store._failpoints = {"after_rename"}
        body, ctype = _Http.json_body({})
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.token, body=body, ctype=ctype)
        self.assertEqual(st, 503)
        self.assertEqual(json.loads(raw)["error"]["code"], "unavailable")
        # F4: retry encountering publishing is 409 (prepares ready).
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.token, body=body, ctype=ctype)
        self.assertEqual(st, 409)
        self.assertEqual(json.loads(raw)["error"]["code"],
                         "state-conflict")
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.token, body=body, ctype=ctype)
        self.assertEqual(st, 200, raw[:300])
        st, _, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/big.bin/content" % aid,
            self.token, origin=None)
        self.assertEqual(st, 200)
        self.assertEqual(got, data)

    def test_r11_http_actual_fsync_commit_faults_unserved_then_recover(self):
        # R11: inject at fstat-identified actual live/ + data_dir fsyncs
        # and actual ready COMMIT (not just failpoint positions); byte
        # endpoints stay unserved (no 200 bytes) until recovery completes
        # with full bytes+hash.
        import sqlite3 as _sqlite
        from unittest import mock as _mock
        import stat as _stat
        chunk = 262144
        self._chunked_server(chunk)
        for tag, fault in (("live", "fsync-live"),
                           ("data", "fsync-data"),
                           ("commit", "commit")):
            size = chunk + 10
            data = bytes((i + len(tag)) % 251 for i in range(size))
            files = [{"path": "big.bin", "kind": "file", "size": size,
                      "sha256": hashlib.sha256(data).hexdigest()}] 
            st, _, raw = _init_artifact(self.http, self.token, files=files)
            aid = json.loads(raw)["artifact_id"]
            _put_chunk(self.http, self.token, aid, "big.bin", 0,
                       data[:chunk])
            _put_chunk(self.http, self.token, aid, "big.bin", chunk,
                       data[chunk:])
            store = self.server._store
            live_id = None
            data_id = None
            try:
                live_id = (lambda st: (st.st_dev, st.st_ino))(
                    __import__("os").stat(
                        __import__("os").path.join(store.data_dir, "live")))
                data_id = (lambda st: (st.st_dev, st.st_ino))(
                    __import__("os").stat(store.data_dir))
            except OSError:
                pass
            real_fsync = __import__("os").fsync
            real_execute = store._db.execute
            commit_count = [0]

            def faulty_fsync(fd):
                import os as _os
                try:
                    st = _os.fstat(fd)
                except OSError:
                    return real_fsync(fd)
                if _stat.S_ISDIR(st.st_mode):
                    key = (st.st_dev, st.st_ino)
                    if fault == "fsync-live" and key == live_id:
                        raise OSError("injected live/ fault")
                    if fault == "fsync-data" and key == data_id:
                        raise OSError("injected data_dir fault")
                return real_fsync(fd)

            def faulty_execute(query, params=()):
                if isinstance(query, str) and query.strip().upper() == \
                        "COMMIT" and fault == "commit":
                    commit_count[0] += 1
                    # Fail only the ready COMMIT (second COMMIT in publish:
                    # P2 publishing-mark succeeds, P5 ready fails to make
                    # lost-P5 with live present).
                    if commit_count[0] >= 2:
                        raise _sqlite.OperationalError("injected commit")
                return real_execute(query, params)

            class _Conn:
                def execute(self, q, p=()):
                    return faulty_execute(q, p)

                def __getattr__(self, name):
                    return getattr(real_execute, name)
            body, ctype = _Http.json_body({})
            # For COMMIT fault, wrap the connection; for fsync faults, mock
            # os.fsync with fstat identification.
            if fault == "commit":
                orig_db = store._db
                store._db = _Conn()  # type: ignore[assignment]
                try:
                    st, _, raw = self.http.api(
                        "POST", "/api/v1/artifacts/%s/publish" % aid,
                        self.token, body=body, ctype=ctype)
                finally:
                    store._db = orig_db
            else:
                with _mock.patch("os.fsync", side_effect=faulty_fsync):
                    st, _, raw = self.http.api(
                        "POST", "/api/v1/artifacts/%s/publish" % aid,
                        self.token, body=body, ctype=ctype)
            # Publish interrupted: 503 (live path, live present) or 409
            # (F4 inline-recovery path); never 200 with bytes.
            self.assertIn(st, (503, 409), (tag, st, raw[:200]))
            # Byte endpoints remain unserved (no partial bytes).
            st2, _, raw2 = self.http.api(
                "GET", "/api/v1/artifacts/%s/files/big.bin/content" % aid,
                self.token, origin=None)
            self.assertIn(st2, (409, 404), (tag, st2))
            if st2 == 409:
                self.assertEqual(json.loads(raw2)["error"]["code"],
                                 "incomplete-upload")
            # Recover: clear faults, retry to ready (F4 409 then 200).
            st, _, raw = self.http.api(
                "POST", "/api/v1/artifacts/%s/publish" % aid,
                self.token, body=body, ctype=ctype)
            if st == 409:
                st, _, raw = self.http.api(
                    "POST", "/api/v1/artifacts/%s/publish" % aid,
                    self.token, body=body, ctype=ctype)
            self.assertEqual(st, 200, (tag, raw[:300]))
            st, _, got = self.http.api(
                "GET", "/api/v1/artifacts/%s/files/big.bin/content" % aid,
                self.token, origin=None)
            self.assertEqual(st, 200)
            self.assertEqual(got, data)
            self.assertEqual(hashlib.sha256(got).hexdigest(),
                             hashlib.sha256(data).hexdigest())

    # -- R11-resumability: tree loss without restart ---------------------------
    def test_r11_http_tree_loss_resumes_without_restart(self):
        import shutil as _shutil
        chunk = self._chunked_server()
        size = chunk + 40
        data = bytes(i % 251 for i in range(size))
        files = [{"path": "big.bin", "kind": "file", "size": size,
                  "sha256": hashlib.sha256(data).hexdigest()}] 
        st, _, raw = _init_artifact(self.http, self.token, files=files)
        aid = json.loads(raw)["artifact_id"]
        _put_chunk(self.http, self.token, aid, "big.bin", 0, data[:chunk])
        _put_chunk(self.http, self.token, aid, "big.bin", chunk,
                   data[chunk:])
        # lose the whole staging tree out-of-band while uploading
        _shutil.rmtree(os.path.join(self.tmp.name, "data", "staging", aid),
                       ignore_errors=True)
        # identical re-uploads rewrite (not falsely ack), publish heals dirs
        st, _, _ = _put_chunk(self.http, self.token, aid, "big.bin", 0,
                              data[:chunk])
        self.assertEqual(st, 200)
        st, _, _ = _put_chunk(self.http, self.token, aid, "big.bin", chunk,
                              data[chunk:])
        self.assertEqual(st, 200)
        st, _, raw = self.http.api(
            "GET", "/api/v1/artifacts/%s/upload-status" % aid, self.token,
            origin=None)
        self.assertEqual(json.loads(raw)["files"][0]["received_bytes"],
                         size)
        body, ctype = _Http.json_body({})
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.token, body=body, ctype=ctype)
        self.assertEqual(st, 200, raw[:300])
        st, _, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/big.bin/content" % aid,
            self.token, origin=None)
        self.assertEqual(got, data)

    # -- R10 empty files / empty directories -----------------------------
    def test_r10_empty_file_roundtrip(self):
        empty_sha = hashlib.sha256(b"").hexdigest()
        files = [{"path": "empty.bin", "kind": "file", "size": 0,
                  "sha256": empty_sha}]
        st, _, raw = _init_artifact(self.http, self.token, files=files)
        self.assertEqual(st, 200, raw[:200])
        aid = json.loads(raw)["artifact_id"]
        body, ctype = _Http.json_body({})
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.token, body=body, ctype=ctype)
        self.assertEqual(st, 200, raw[:300])
        st, _, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/empty.bin/content" % aid,
            self.token, origin=None)
        self.assertEqual(st, 200)
        self.assertEqual(got, b"")

    def test_r10_empty_root_and_nested_dirs_survive_restart(self):
        st, _, raw = _init_artifact(self.http, self.token, kind="dir",
                                    files=[], name="emptyroot")
        self.assertEqual(st, 200)
        aid = json.loads(raw)["artifact_id"]
        files = [
            {"path": "a", "kind": "dir"},
            {"path": "a/b", "kind": "dir"},
            {"path": "index.html", "kind": "file", "size": 5,
             "sha256": hashlib.sha256(b"hello").hexdigest()},
        ]
        st, _, raw = _init_artifact(self.http, self.token, kind="dir",
                                    files=files, name="nested")
        aid2 = json.loads(raw)["artifact_id"]
        body, ctype = _Http.json_body({})
        for target, blobs in ((aid, {}), (aid2, {"index.html": b"hello"})):
            for path, blob in blobs.items():
                _put_chunk(self.http, self.token, target, path, 0, blob)
            st, _, raw = self.http.api(
                "POST", "/api/v1/artifacts/%s/publish" % target,
                self.token, body=body, ctype=ctype)
            self.assertEqual(st, 200, raw[:300])
        self.server.close()
        self.server = create_server(_make_config(self.tmp.name, self.users))
        self.http = _Http(self.server.bound_port,
                          self.server.effective_api_origin)
        for target in (aid, aid2):
            st, _, raw = self.http.api("GET", "/api/v1/artifacts/%s" % target,
                                       self.token, origin=None)
            self.assertEqual(json.loads(raw)["state"], "ready")
        st, _, raw = self.http.api("GET", "/api/v1/artifacts/%s/files" % aid2,
                                   self.token, origin=None)
        paths = {e["path"] for e in json.loads(raw)["files"]}
        self.assertEqual(paths, {"a", "a/b", "index.html"})

    # -- F7 ------------------------------------------------------------
    def test_f7_publish_idempotent_and_publishing_conflict(self):
        data = b"pub"
        files = [{"path": "f.bin", "kind": "file", "size": 3,
                  "sha256": hashlib.sha256(data).hexdigest()}]
        st, _, raw = _init_artifact(self.http, self.token, files=files)
        aid = json.loads(raw)["artifact_id"]
        _put_chunk(self.http, self.token, aid, "f.bin", 0, data)
        body, ctype = _Http.json_body({})
        st, _, first = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                     self.token, body=body, ctype=ctype)
        self.assertEqual(st, 200)
        # double publish idempotent, same content_url
        st, _, second = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                      self.token, body=body, ctype=ctype)
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(first)["content_url"],
                         json.loads(second)["content_url"])

    def test_f7_publish_crash_windows_reconcile(self):
        from manure.storage import ArtifactStore
        data = b"crash-window"
        files = [{"path": "f.bin", "kind": "file", "size": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}]
        st, _, raw = _init_artifact(self.http, self.token, files=files)
        aid = json.loads(raw)["artifact_id"]
        _put_chunk(self.http, self.token, aid, "f.bin", 0, data)
        # exclusive claim: stop the server before direct store surgery
        self.server.close()
        store = ArtifactStore(os.path.join(self.tmp.name, "data"))
        try:
            # force publishing with staging complete, live absent -> redo
            store._set_state_for_test(aid, "publishing")
        finally:
            store.close()
        self.server = create_server(_make_config(self.tmp.name, self.users))
        self.http = _Http(self.server.bound_port,
                          self.server.effective_api_origin)
        body, ctype = _Http.json_body({})
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.token, body=body, ctype=ctype)
        self.assertEqual(st, 200, raw[:300])
        st, _, raw = self.http.api("GET", "/api/v1/artifacts/%s" % aid,
                                   self.token, origin=None)
        self.assertEqual(json.loads(raw)["state"], "ready")

    # -- F8 ------------------------------------------------------------
    def test_f8_pagination_order_cursor(self):
        ids = []
        for i in range(5):
            st, _, raw = _init_artifact(self.http, self.token, name="a%d" % i)
            ids.append(json.loads(raw)["artifact_id"])
            time.sleep(1.05)  # distinct created_at seconds: insertion order
        st, _, raw = self.http.api("GET", "/api/v1/artifacts?limit=2",
                                   self.token, origin=None)
        self.assertEqual(st, 200)
        page1 = json.loads(raw)
        self.assertEqual(len(page1["artifacts"]), 2)
        self.assertIsNotNone(page1["next_cursor"])
        self.assertEqual([a["artifact_id"] for a in page1["artifacts"]], ids[:2])
        st, _, raw = self.http.api(
            "GET", "/api/v1/artifacts?limit=2&cursor=%s" % urllib.parse.quote(
                page1["next_cursor"], safe=""), self.token, origin=None)
        page2 = json.loads(raw)
        self.assertEqual([a["artifact_id"] for a in page2["artifacts"]], ids[2:4])
        st, _, raw = self.http.api(
            "GET", "/api/v1/artifacts?limit=2&cursor=%s" % urllib.parse.quote(
                page2["next_cursor"], safe=""), self.token, origin=None)
        page3 = json.loads(raw)
        self.assertEqual([a["artifact_id"] for a in page3["artifacts"]], ids[4:])
        self.assertIsNone(page3["next_cursor"])
        # full traversal is stable and gap-free regardless of clock ties
        seen = [a["artifact_id"] for a in
                page1["artifacts"] + page2["artifacts"] + page3["artifacts"]]
        self.assertEqual(sorted(seen), sorted(ids))
        self.assertEqual(len(set(seen)), 5)
        # invalid cursor -> 400
        st, _, raw = self.http.api("GET", "/api/v1/artifacts?cursor=!!!",
                                   self.token, origin=None)
        self.assertEqual(st, 400)
        self.assertEqual(json.loads(raw)["error"]["code"], "bad-envelope")
        # list/info carry no hashes or passwords
        self.assertNotIn("sha256", json.dumps(page1))
        self.assertNotIn("password", json.dumps(page1).lower())

    # -- F8b -----------------------------------------------------------
    def test_f8b_uploading_bytes_409_and_hash_mismatch(self):
        self.server.close()
        self.server = create_server(_make_config(
            self.tmp.name, self.users, chunk_bytes=262144))
        self.http = _Http(self.server.bound_port,
                          self.server.effective_api_origin)
        chunk = 262144
        data = bytes(i % 251 for i in range(chunk + 100))
        files = [{"path": "f.bin", "kind": "file", "size": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}]
        st, _, raw = _init_artifact(self.http, self.token, files=files)
        aid = json.loads(raw)["artifact_id"]
        _put_chunk(self.http, self.token, aid, "f.bin", 0, data[:chunk])
        st, _, raw = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % aid, self.token,
            origin=None)
        self.assertEqual(st, 409)
        self.assertEqual(json.loads(raw)["error"]["code"], "incomplete-upload")
        # corrupt staged bytes behind the receipts -> publish 409 hash-mismatch
        tree_path = os.path.join(self.tmp.name, "data", "staging", aid,
                                 "tree", "f.bin")
        with open(tree_path, "r+b") as fh:
            fh.seek(0)
            fh.write(b"XXXX")
        _put_chunk(self.http, self.token, aid, "f.bin", chunk, data[chunk:])
        body, ctype = _Http.json_body({})
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.token, body=body, ctype=ctype)
        self.assertEqual(st, 409)
        self.assertEqual(json.loads(raw)["error"]["code"], "hash-mismatch")


if __name__ == "__main__":
    unittest.main()
