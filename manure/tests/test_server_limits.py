"""F5 TTL + F9b bounds/quotas/throttles/sweep spec (server owned).

Same fixture as test_server_lifecycle (see its header). Private clock
injection ``create_server(config, _now=...)`` is tests-only and never
read from config/env.
"""

import hashlib
import http.client
import json
import os
import tempfile
import threading
import time
import unittest
import urllib.parse

from manure import auth as authmod
from manure.server import ServerConfig, create_server


def _write_hashfile(tmpdir, digest, tag="t"):
    path = os.path.join(tmpdir, "tok-%s-%s.hash" % (tag, digest[:12]))
    with open(path, "w", encoding="ascii") as fh:
        fh.write(digest + "\n")
    return path


def _mint(tmpdir, uid, tid, utype="agent"):
    token = authmod.generate_token()
    digest = authmod.sha256_hex(token)
    entry = {"id": uid, "type": utype,
             "tokens": [{"id": tid,
                         "hashFile": _write_hashfile(tmpdir, digest, tid)}]}
    return entry, token


def _make_config(tmpdir, users, subdir="data", **overrides):
    cfg = {
        "data_dir": os.path.join(tmpdir, subdir),
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
    def __init__(self, port, api_origin):
        self.port = port
        self.api_origin = api_origin
        self.api_host = urllib.parse.urlsplit(api_origin).netloc

    def request(self, method, path, host, body=None, ctype=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
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
        out = dict(resp.getheaders())
        status = resp.status
        conn.close()
        return status, out, data

    def api(self, method, path, token=None, origin="present", **kw):
        headers = dict(kw.pop("headers", {}) or {})
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        if origin == "present":
            headers["Origin"] = self.api_origin
        elif origin is not None:
            headers["Origin"] = origin
        return self.request(method, path, self.api_host, headers=headers, **kw)


class Clock:
    def __init__(self):
        self.t = [time.time()]

    def now(self):
        return self.t[0]

    def advance(self, seconds):
        self.t[0] += seconds


def _init(http, token, data=b"ttl-bytes", visibility="internal", **extra):
    files = [{"path": "f.bin", "kind": "file", "size": len(data),
              "sha256": hashlib.sha256(data).hexdigest()}]
    payload = {"name": "n", "kind": "file", "visibility": visibility,
               "files": files}
    payload.update(extra)
    body = json.dumps(payload).encode()
    st, _, raw = http.api("POST", "/api/v1/artifacts:init", token,
                          body=body, ctype="application/json")
    assert st == 200, raw[:300]
    return json.loads(raw)


class LimitsCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        u1, self.tok1 = _mint(self.tmp.name, "u1", "t1")
        self.users = [u1]
        self.clock = Clock()
        self.server = create_server(_make_config(self.tmp.name, self.users),
                                    _now=self.clock.now)
        self.addCleanup(lambda: self.server.close())
        self.http = _Http(self.server.bound_port,
                          self.server.effective_api_origin)

    # -- F5 ------------------------------------------------------------
    def test_ttl_immediate_cutoff_and_sweep(self):
        resp = _init(self.http, self.tok1, expires_in_s=60)
        aid = resp["artifact_id"]
        # before expiry: visible
        st, _, _ = self.http.api("GET", "/api/v1/artifacts/%s" % aid,
                                 self.tok1, origin=None)
        self.assertEqual(st, 200)
        self.clock.advance(61)
        # authed API reads -> 410 expired
        st, _, raw = self.http.api("GET", "/api/v1/artifacts/%s" % aid,
                                   self.tok1, origin=None)
        self.assertEqual(st, 410)
        self.assertEqual(json.loads(raw)["error"]["code"], "expired")
        # content host -> 404 (anonymous-facing)
        host = "%s.artifacts.localhost:%d" % (aid, self.http.port)
        st, _, raw = self.http.request("GET", "/f.bin", host)
        self.assertEqual(st, 404)
        # hidden from default list, shown with include_expired
        st, _, raw = self.http.api("GET", "/api/v1/artifacts", self.tok1,
                                   origin=None)
        self.assertNotIn(aid, raw.decode())
        st, _, raw = self.http.api(
            "GET", "/api/v1/artifacts?include_expired=true", self.tok1,
            origin=None)
        self.assertIn(aid, raw.decode())
        # sweeper physically removes
        n = self.server.sweep_for_test()
        self.assertGreaterEqual(n, 1)
        st, _, raw = self.http.api(
            "GET", "/api/v1/artifacts?include_expired=true", self.tok1,
            origin=None)
        self.assertNotIn(aid, raw.decode())

    def test_ttl_patch_shorten_extend_clear(self):
        resp = _init(self.http, self.tok1, expires_in_s=3600)
        aid = resp["artifact_id"]
        for value, expect in ((60, 200), (7200, 200), (59, 400),
                              (31536001, 400)):
            body = json.dumps({"expires_in_s": value}).encode()
            st, _, raw = self.http.api("PATCH", "/api/v1/artifacts/%s" % aid,
                                       self.tok1, body=body,
                                       ctype="application/json")
            self.assertEqual(st, expect, (value, raw[:200]))
        body = json.dumps({"expires_in_s": None}).encode()
        st, _, raw = self.http.api("PATCH", "/api/v1/artifacts/%s" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 200)
        self.assertIsNone(json.loads(raw)["expires_at"])

    # -- F9b -----------------------------------------------------------
    # -- R5 oversized / malformed framing ------------------------------------
    def _external_ready(self, http, token):
        data = b"r5-ext"
        files = [{"path": "f.bin", "kind": "file", "size": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}]
        payload = {"name": "n", "kind": "file", "visibility": "external",
                   "files": files}
        body = json.dumps(payload).encode()
        st, _, raw = http.api("POST", "/api/v1/artifacts:init", token,
                               body=body, ctype="application/json")
        assert st == 200, raw[:200]
        resp = json.loads(raw)
        aid, password = resp["artifact_id"], resp["external_password"]
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        http.api("PUT", qp, token, body=data,
                 ctype="application/octet-stream",
                 headers={"X-Chunk-Sha256":
                          hashlib.sha256(data).hexdigest()})
        body = json.dumps({}).encode()
        http.api("POST", "/api/v1/artifacts/%s/publish" % aid, token,
                 body=body, ctype="application/json")
        return aid, password

    def test_r5_oversized_mutations_rejected_without_effect(self):
        resp = _init(self.http, self.tok1)
        aid = resp["artifact_id"]
        big = b"x" * (5 * 1024 * 1024)
        # oversized publish: 413, session still uploading afterwards
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.tok1, body=big,
                                   ctype="application/json")
        self.assertEqual(st, 413)
        body, ctype = json.dumps({}).encode(), "application/json"
        st, _, _ = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                 self.tok1, body=body, ctype=ctype)
        # incomplete (no chunks) -> hash-mismatch proves no publish happened
        self.assertEqual(st, 409)
        # oversized grants: 413, a real grants call still works
        st, _, _ = self.http.api("POST", "/api/v1/artifacts/%s/grants" % aid,
                                 self.tok1, body=big, ctype="application/json")
        self.assertEqual(st, 413)
        # oversized rotate on an external artifact: old password survives
        aid2, password = self._external_ready(self.http, self.tok1)
        st, _, _ = self.http.api(
            "POST", "/api/v1/artifacts/%s/external-password:rotate" % aid2,
            self.tok1, body=big, ctype="application/json")
        self.assertEqual(st, 413)
        origin = "http://%s.artifacts.localhost:%d" % (aid2, self.http.port)
        good = json.dumps({"password": password}).encode()
        st, _, _ = self.http.request(
            "POST", "/__manure/unlock",
            "%s.artifacts.localhost:%d" % (aid2, self.http.port),
            body=good, ctype="application/json",
            headers={"Origin": origin})
        self.assertEqual(st, 200)
        # oversized logout: 413, session NOT revoked
        st, _, _ = self.http.api("POST", "/api/v1/logout", self.tok1,
                                 body=big, ctype="application/json")
        self.assertEqual(st, 413)
        st, _, _ = self.http.api("GET", "/api/v1/whoami", self.tok1,
                                 origin=None)
        self.assertEqual(st, 200)

    def test_r5_oversized_delete_preserves_artifact(self):
        data = b"r5-keepme"
        files = [{"path": "f.bin", "kind": "file", "size": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}]
        payload = {"name": "n", "kind": "file", "visibility": "internal",
                   "files": files}
        body = json.dumps(payload).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts:init",
                                    self.tok1, body=body,
                                    ctype="application/json")
        aid = json.loads(raw)["artifact_id"]
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        self.http.api("PUT", qp, self.tok1, body=data,
                      ctype="application/octet-stream",
                      headers={"X-Chunk-Sha256":
                               hashlib.sha256(data).hexdigest()})
        body = json.dumps({}).encode()
        self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                      self.tok1, body=body, ctype="application/json")
        big = b"x" * (5 * 1024 * 1024)
        st, _, _ = self.http.api("DELETE", "/api/v1/artifacts/%s" % aid,
                                 self.tok1, body=big,
                                 ctype="application/json")
        self.assertEqual(st, 413)
        # rows, bytes, and reservation all intact
        st, _, raw = self.http.api("GET", "/api/v1/artifacts/%s" % aid,
                                   self.tok1, origin=None)
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(raw)["state"], "ready")
        st, _, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % aid,
            self.tok1, origin=None)
        self.assertEqual(got, data)

    def test_r5_oversized_logout_preserves_grants(self):
        resp = _init(self.http, self.tok1)
        aid = resp["artifact_id"]
        # published internal artifact with a live cookie + spare handoff
        data = b"ttl-bytes"
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        sha = hashlib.sha256(data).hexdigest()
        self.http.api("PUT", qp, self.tok1, body=data,
                      ctype="application/octet-stream",
                      headers={"X-Chunk-Sha256": sha})
        body = json.dumps({}).encode()
        self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                      self.tok1, body=body, ctype="application/json")
        cookie = self._grant_cookie(aid)
        spare = self._one_time_grant(aid)
        big = b"x" * (5 * 1024 * 1024)
        st, _, _ = self.http.api("POST", "/api/v1/logout", self.tok1,
                                 body=big, ctype="application/json")
        self.assertEqual(st, 413)
        # pre-existing content cookie still authorizes...
        host = "%s.artifacts.localhost:%d" % (aid, self.http.port)
        st, _, got = self.http.request("GET", "/f.bin", host,
                                       headers={"Cookie": cookie})
        self.assertEqual(st, 200)
        self.assertEqual(got, data)
        # ...and the unredeemed handoff still redeems.
        gbody = urllib.parse.urlencode({"grant": spare}).encode()
        st, _, _ = self.http.request(
            "POST", "/__manure/grant", host, body=gbody,
            ctype="application/x-www-form-urlencoded",
            headers={"Origin": self.http.api_origin})
        self.assertEqual(st, 303)

    def test_r5_stalled_body_preserves_state_password_grants(self):
        # R5: a validly authenticated stalled request declaring an
        # unfinished body must close with 400 before any mutation;
        # state, external password, and grants are preserved.
        import socket as _socket
        server = create_server(_make_config(
            self.tmp.name, self.users, subdir="r5stall",
            request_timeout_s=1))
        self.addCleanup(server.close)
        http = _Http(server.bound_port, server.effective_api_origin)

        def stalled(method, path, token, origin=True):
            s = _socket.create_connection(("127.0.0.1", http.port),
                                          timeout=10)
            headers = (f"{method} {path} HTTP/1.1\r\n"
                       f"Host: {http.api_host}\r\n"
                       f"Authorization: Bearer {token}\r\n")
            if origin:
                headers += f"Origin: {http.api_origin}\r\n"
            headers += ("Content-Type: application/json\r\n"
                        "Content-Length: 100\r\n\r\n{")
            s.sendall(headers.encode())
            time.sleep(2.5)  # stall past request_timeout_s, socket open
            s.settimeout(5)
            try:
                resp = s.recv(4096).decode("latin-1", "replace")
            except _socket.timeout:
                resp = ""
            s.close()
            return resp
        # Uploading artifact: stalled publish preserves uploading.
        resp = _init(http, self.tok1)
        aid = resp["artifact_id"]
        data = b"ttl-bytes"
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        http.api("PUT", qp, self.tok1, body=data,
                 ctype="application/octet-stream",
                 headers={"X-Chunk-Sha256": hashlib.sha256(data).hexdigest()})
        resp_text = stalled("POST", "/api/v1/artifacts/%s/publish" % aid,
                            self.tok1)
        self.assertIn(" 400 ", resp_text.split("\r\n", 1)[0])
        self.assertIn("bad-envelope", resp_text)
        st, _, raw = http.api("GET", "/api/v1/artifacts/%s" % aid,
                              self.tok1, origin=None)
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(raw)["state"], "uploading")
        # Ready artifact: stalled delete preserves rows/bytes/reservation.
        body = json.dumps({}).encode()
        http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                 self.tok1, body=body, ctype="application/json")
        resp_text = stalled("DELETE", "/api/v1/artifacts/%s" % aid,
                            self.tok1)
        self.assertIn(" 400 ", resp_text.split("\r\n", 1)[0])
        st, _, raw = http.api("GET", "/api/v1/artifacts/%s" % aid,
                              self.tok1, origin=None)
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(raw)["state"], "ready")
        # External password: stalled rotate preserves the old password.
        aid2, password = self._external_ready(http, self.tok1)
        resp_text = stalled(
            "POST",
            "/api/v1/artifacts/%s/external-password:rotate" % aid2,
            self.tok1)
        self.assertIn(" 400 ", resp_text.split("\r\n", 1)[0])
        origin2 = "http://%s.artifacts.localhost:%d" % (aid2, http.port)
        good = json.dumps({"password": password}).encode()
        st, _, _ = http.request(
            "POST", "/__manure/unlock",
            "%s.artifacts.localhost:%d" % (aid2, http.port),
            body=good, ctype="application/json",
            headers={"Origin": origin2})
        self.assertEqual(st, 200)
        # Grants: stalled logout preserves content cookie + handoff.
        body = json.dumps({}).encode()
        st, _, raw = http.api(
            "POST", "/api/v1/artifacts/%s/grants" % aid, self.tok1,
            body=body, ctype="application/json")
        grant = json.loads(raw)["grant"]
        gbody = urllib.parse.urlencode({"grant": grant}).encode()
        host = "%s.artifacts.localhost:%d" % (aid, http.port)
        st, hdrs, _ = http.request(
            "POST", "/__manure/grant", host, body=gbody,
            ctype="application/x-www-form-urlencoded",
            headers={"Origin": http.api_origin})
        cookie = hdrs["Set-Cookie"].split(";", 1)[0]
        resp_text = stalled("POST", "/api/v1/logout", self.tok1)
        self.assertIn(" 400 ", resp_text.split("\r\n", 1)[0])
        st, _, got = http.request("GET", "/f.bin", host,
                                  headers={"Cookie": cookie})
        self.assertEqual(st, 200)
        self.assertEqual(got, data)

    def _grant_cookie(self, aid):
        body = json.dumps({}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/grants" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 200, raw[:200])
        grant = json.loads(raw)["grant"]
        gbody = urllib.parse.urlencode({"grant": grant}).encode()
        host = "%s.artifacts.localhost:%d" % (aid, self.http.port)
        st, hdrs, _ = self.http.request(
            "POST", "/__manure/grant", host, body=gbody,
            ctype="application/x-www-form-urlencoded",
            headers={"Origin": self.http.api_origin})
        self.assertEqual(st, 303)
        return hdrs["Set-Cookie"].split(";", 1)[0]

    def _one_time_grant(self, aid):
        body = json.dumps({}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/grants" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 200, raw[:200])
        return json.loads(raw)["grant"]

    @staticmethod
    def _read_all(sock):
        import socket as _socket
        sock.settimeout(5)
        blob = b""
        try:
            while True:
                block = sock.recv(65536)
                if not block:
                    break
                blob += block
        except _socket.timeout:
            pass
        return blob.decode("latin-1", "replace")

    def test_r5_malformed_framing_and_canary(self):
        import socket as _socket
        # duplicate Content-Length: 400, connection unusable afterwards
        sock = _socket.create_connection(("127.0.0.1", self.http.port),
                                         timeout=10)
        req = ("GET /api/v1/health HTTP/1.1\r\nHost: %s\r\n"
               "Content-Length: 0\r\nContent-Length: 0\r\n\r\n"
               % self.http.api_host)
        sock.sendall(req.encode())
        resp = self._read_all(sock)
        self.assertIn(" 400 ", resp.split("\r\n", 1)[0])
        self.assertIn("bad-envelope", resp)
        sock.close()
        # Transfer-Encoding: 400
        sock = _socket.create_connection(("127.0.0.1", self.http.port),
                                         timeout=10)
        req = ("POST /api/v1/login HTTP/1.1\r\nHost: %s\r\n"
               "Origin: %s\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n"
               % (self.http.api_host, self.http.api_origin))
        sock.sendall(req.encode())
        resp = self._read_all(sock)
        self.assertIn(" 400 ", resp.split("\r\n", 1)[0])
        sock.close()
        # secret canary in a pipelined garbage line is never echoed
        canary = "canary-%s" % authmod.generate_token()[:12]
        sock = _socket.create_connection(("127.0.0.1", self.http.port),
                                         timeout=10)
        req = ("GET /api/v1/health HTTP/1.1\r\nHost: %s\r\n\r\n"
               "GARBAGE %s HTTP/1.1\r\n\r\n" % (self.http.api_host,
                                                     canary))
        sock.sendall(req.encode())
        sock.settimeout(5)
        blob = b""
        try:
            while True:
                block = sock.recv(65536)
                if not block:
                    break
                blob += block
        except _socket.timeout:
            pass
        sock.close()
        text = blob.decode("latin-1", "replace")
        self.assertIn('"ok": true', text)  # first response healthy
        self.assertNotIn(canary, text)  # parser error echoes nothing
        self.assertIn("not-found", text)  # unknown method -> JSON fault

    def test_oversized_json_body_413(self):
        big = {"name": "x" * (5 * 1024 * 1024)}
        body = json.dumps(big).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts:init",
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 413)

    def test_chunk_size_cap_and_alignment(self):
        data = b"y" * 100
        files = [{"path": "f.bin", "kind": "file", "size": 100,
                  "sha256": hashlib.sha256(data).hexdigest()}]
        body = json.dumps({"name": "n", "kind": "file",
                           "visibility": "internal",
                           "files": files}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts:init",
                                   self.tok1, body=body,
                                   ctype="application/json")
        aid = json.loads(raw)["artifact_id"]
        chunk_bytes = json.loads(raw)["chunk_bytes"]
        # body bigger than server chunk_bytes -> 413
        too_big = b"z" * (chunk_bytes + 1)
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        st, _, _ = self.http.api(
            "PUT", qp, self.tok1, body=too_big,
            ctype="application/octet-stream",
            headers={"X-Chunk-Sha256": hashlib.sha256(too_big).hexdigest()})
        self.assertEqual(st, 413)
        # misaligned non-tail chunk -> invalid-range (file needs 2 chunks:
        # use a fresh artifact sized 2*chunk+10 and send short first chunk)
        size = 2 * chunk_bytes + 10
        blob = b"q" * size
        files = [{"path": "g.bin", "kind": "file", "size": size,
                  "sha256": hashlib.sha256(blob).hexdigest()}]
        body = json.dumps({"name": "n", "kind": "file",
                           "visibility": "internal",
                           "files": files}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts:init",
                                   self.tok1, body=body,
                                   ctype="application/json")
        aid2 = json.loads(raw)["artifact_id"]
        short = blob[:100]
        qp = "/api/v1/artifacts/%s/chunks?path=g.bin&offset=0" % aid2
        st, _, raw = self.http.api(
            "PUT", qp, self.tok1, body=short,
            ctype="application/octet-stream",
            headers={"X-Chunk-Sha256": hashlib.sha256(short).hexdigest()})
        self.assertEqual(st, 400)
        self.assertEqual(json.loads(raw)["error"]["code"], "invalid-range")

    def test_quota_reservation_concurrent_subset(self):
        self.server.close()
        u, tok = self.users[0], self.tok1
        self.server = create_server(_make_config(
            self.tmp.name, [u], subdir="quota",
            storage_quota_bytes=3000, max_sessions_per_user=100,
            max_sessions_global=1000))
        http = _Http(self.server.bound_port, self.server.effective_api_origin)
        results = []
        lock = threading.Lock()

        def worker(i):
            data = bytes([i % 256]) * 1000
            files = [{"path": "f.bin", "kind": "file", "size": 1000,
                      "sha256": hashlib.sha256(data).hexdigest()}]
            body = json.dumps({"name": "q%d" % i, "kind": "file",
                               "visibility": "internal",
                               "files": files}).encode()
            st, _, raw = http.api("POST", "/api/v1/artifacts:init", tok,
                                  body=body, ctype="application/json")
            with lock:
                results.append(st)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        # exactly 3 fit in 3000 bytes; rest quota-exceeded
        self.assertEqual(sorted(results), [200, 200, 200, 413, 413])

    def test_session_caps_429(self):
        self.server.close()
        self.server = create_server(_make_config(
            self.tmp.name, self.users, subdir="sess",
            max_sessions_per_user=1, max_sessions_global=1000))
        http = _Http(self.server.bound_port, self.server.effective_api_origin)
        _init(http, self.tok1)
        body = json.dumps({"name": "s2", "kind": "dir",
                           "visibility": "internal", "files": []}).encode()
        st, hdrs, raw = http.api("POST", "/api/v1/artifacts:init", self.tok1,
                                 body=body, ctype="application/json")
        self.assertEqual(st, 429)
        self.assertEqual(json.loads(raw)["error"]["code"], "session-limit")
        self.assertIn("Retry-After", hdrs)

    def test_login_throttle_and_mutation_rate_limit(self):
        self.server.close()
        self.server = create_server(_make_config(
            self.tmp.name, self.users, subdir="rate",
            login_rate_per_min_per_ip=2, rate_limit_per_min=1000))
        http = _Http(self.server.bound_port, self.server.effective_api_origin)
        body = json.dumps({"token": "x" * 43}).encode()
        for _ in range(2):
            http.api("POST", "/api/v1/login", None, body=body,
                     ctype="application/json")
        st, hdrs, raw = http.api("POST", "/api/v1/login", None, body=body,
                                 ctype="application/json")
        self.assertEqual(st, 429)
        self.assertIn("Retry-After", hdrs)
        # per-principal mutation throttle (separate server, tiny budget)
        self.server.close()
        self.server = create_server(_make_config(
            self.tmp.name, self.users, subdir="rate2",
            rate_limit_per_min=2, login_rate_per_min_per_ip=1000))
        http = _Http(self.server.bound_port, self.server.effective_api_origin)
        _init(http, self.tok1)
        _init(http, self.tok1)
        st, _, raw = http.api("POST", "/api/v1/logout", self.tok1,
                              body=json.dumps({}).encode(),
                              ctype="application/json")
        self.assertEqual(st, 429)
        self.assertEqual(json.loads(raw)["error"]["code"], "rate-limited")

    # -- R15 ---------------------------------------------------------------
    def test_r15_expiry_status_by_authentication(self):
        data = b"r15-public"
        files = [{"path": "f.bin", "kind": "file", "size": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}]
        payload = {"name": "n", "kind": "file", "visibility": "public",
                   "files": files, "expires_in_s": 60}
        body = json.dumps(payload).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts:init",
                                    self.tok1, body=body,
                                    ctype="application/json")
        aid = json.loads(raw)["artifact_id"]
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        self.http.api("PUT", qp, self.tok1, body=data,
                      ctype="application/octet-stream",
                      headers={"X-Chunk-Sha256":
                               hashlib.sha256(data).hexdigest()})
        body = json.dumps({}).encode()
        self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                      self.tok1, body=body, ctype="application/json")
        self.clock.advance(61)
        # anonymous API reads: 404 expired; authenticated API reads: 410
        for path in ("/api/v1/artifacts/%s/files" % aid,
                     "/api/v1/artifacts/%s/files/f.bin/content" % aid):
            st, _, raw = self.http.api("GET", path, None, origin=None)
            self.assertEqual(st, 404, path)
            self.assertEqual(json.loads(raw)["error"]["code"], "expired")
            st, _, raw = self.http.api("GET", path, self.tok1, origin=None)
            self.assertEqual(st, 410, path)
            self.assertEqual(json.loads(raw)["error"]["code"], "expired")

    def test_r15_activity_allowlist(self):
        # idempotent chunk retries advance activity (survive sweep)...
        resp = _init(self.http, self.tok1)
        aid = resp["artifact_id"]
        self.clock.advance(86000)
        st, _, raw = self.http.api(
            "GET", "/api/v1/artifacts/%s/upload-status" % aid, self.tok1,
            origin=None)
        pending = json.loads(raw)["files"]
        self.assertEqual(pending[0]["received_bytes"], 0)
        data = b"ttl-bytes"
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        sha = hashlib.sha256(data).hexdigest()
        self.http.api("PUT", qp, self.tok1, body=data,
                      ctype="application/octet-stream",
                      headers={"X-Chunk-Sha256": sha})
        self.clock.advance(1000)  # past the original idle deadline...
        self.http.api("PUT", qp, self.tok1, body=data,  # ...retry advances
                      ctype="application/octet-stream",
                      headers={"X-Chunk-Sha256": sha})
        self.clock.advance(86000)
        self.assertEqual(self.server.sweep_for_test(), 0)  # still alive
        # ...while rotation does not extend idle sessions.
        ext = _init(self.http, self.tok1, visibility="external")
        aid2 = ext["artifact_id"]
        self.clock.advance(86000)
        body = json.dumps({}).encode()
        self.http.api("POST", "/api/v1/artifacts/%s/external-password:rotate"
                      % aid2, self.tok1, body=body, ctype="application/json")
        self.clock.advance(1000)
        self.assertGreaterEqual(self.server.sweep_for_test(), 1)
        st, _, _ = self.http.api("GET", "/api/v1/artifacts/%s" % aid2,
                                 self.tok1, origin=None)
        self.assertEqual(st, 404)

    def test_idle_sessions_swept_and_activity_definition(self):
        resp = _init(self.http, self.tok1)
        aid = resp["artifact_id"]
        self.clock.advance(86500)
        n = self.server.sweep_for_test()
        self.assertGreaterEqual(n, 1)
        st, _, _ = self.http.api("GET", "/api/v1/artifacts/%s" % aid,
                                 self.tok1, origin=None)
        self.assertEqual(st, 404)
        # reads never advance activity: fresh session, status read, idle sweep
        resp = _init(self.http, self.tok1)
        aid2 = resp["artifact_id"]
        self.http.api("GET", "/api/v1/artifacts/%s/upload-status" % aid2,
                      self.tok1, origin=None)
        self.clock.advance(86500)
        n = self.server.sweep_for_test()
        self.assertGreaterEqual(n, 1)

    def _stall_chunk(self, http, aid, nbytes=8):
        import socket as _socket
        sock = _socket.create_connection(("127.0.0.1", http.port),
                                         timeout=10)
        target = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        req = ("PUT %s HTTP/1.1\r\nHost: %s\r\nAuthorization: Bearer %s\r\n"
               "Origin: %s\r\nContent-Type: application/octet-stream\r\n"
               "X-Chunk-Sha256: %s\r\nContent-Length: %d\r\n\r\n" % (
                   target, http.api_host, self.tok1, http.api_origin,
                   hashlib.sha256(b"1" * nbytes).hexdigest(), nbytes))
        sock.sendall(req.encode())
        return sock

    def test_max_connections_503_with_retry_after(self):
        self.server.close()
        self.server = create_server(_make_config(
            self.tmp.name, self.users, subdir="conn", max_connections=1,
            request_timeout_s=20))
        http = _Http(self.server.bound_port, self.server.effective_api_origin)
        resp = _init(http, self.tok1)
        aid = resp["artifact_id"]
        # occupy the single slot with a stalled chunk body
        sock = self._stall_chunk(http, aid)
        time.sleep(0.7)  # let the worker block on body read holding the slot
        try:
            self.assertEqual(self.server.active_count_for_test(), 1)
            st, hdrs, raw = http.api("GET", "/api/v1/health", None,
                                     origin=None)
            self.assertEqual(st, 503)
            self.assertIn("Retry-After", hdrs)
            self.assertIn("Origin-Agent-Cluster", hdrs)
            self.assertEqual(json.loads(raw)["error"]["code"],
                             "unavailable")
        finally:
            try:
                sock.sendall(b"12345678")
                sock.close()
            except OSError:
                pass

    def test_r7_worker_bound_and_graceful_shutdown(self):
        self.server.close()
        self.server = create_server(_make_config(
            self.tmp.name, self.users, subdir="r7", max_connections=3,
            request_timeout_s=20))
        http = _Http(self.server.bound_port, self.server.effective_api_origin)
        resp = _init(http, self.tok1)
        aid = resp["artifact_id"]
        stalls = [self._stall_chunk(http, aid) for _ in range(3)]
        time.sleep(0.9)
        try:
            # admission bound == worker bound: exactly 3 workers exist
            self.assertEqual(self.server.active_count_for_test(), 3)
            st, _, _ = http.api("GET", "/api/v1/health", None, origin=None)
            self.assertEqual(st, 503)
            self.assertEqual(self.server.active_count_for_test(), 3)
        finally:
            for sock in stalls:
                try:
                    sock.close()
                except OSError:
                    pass
        deadline = time.time() + 10
        while self.server.active_count_for_test() and time.time() < deadline:
            time.sleep(0.05)
        self.assertEqual(self.server.active_count_for_test(), 0)
        # graceful shutdown with an idle keep-alive socket lingering
        idle = __import__("socket").create_connection(
            ("127.0.0.1", http.port), timeout=10)
        idle.sendall(("GET /api/v1/health HTTP/1.1\r\nHost: %s\r\n\r\n"
                      % http.api_host).encode())
        time.sleep(0.4)
        started = time.time()
        self.server.close(grace_s=0.5)
        self.assertLess(time.time() - started, 12)
        try:
            idle.close()
        except OSError:
            pass
        # claim released + storage closed: the data_dir restarts cleanly
        server2 = create_server(_make_config(
            self.tmp.name, self.users, subdir="r7"))
        try:
            http2 = _Http(server2.bound_port, server2.effective_api_origin)
            st, _, _ = http2.api("GET", "/api/v1/health", None,
                                  origin=None)
            self.assertEqual(st, 200)
        finally:
            server2.close()


    # -- R7 deterministic shutdown ------------------------------------------------
    def _gate_method(self, name, entered, release):
        from unittest import mock
        from manure.storage import ArtifactStore
        real = getattr(ArtifactStore, name)

        def gate(self, *args, **kwargs):
            entered.set()
            self._release_ok = release.wait(timeout=20)
            return real(self, *args, **kwargs)
        return mock.patch.object(ArtifactStore, name, autospec=True,
                                 side_effect=gate)

    def test_r7_close_orders_after_inflight_chunk_commit(self):
        import threading
        self.server.close()
        self.server = create_server(_make_config(
            self.tmp.name, self.users, subdir="r7c", request_timeout_s=20))
        http = _Http(self.server.bound_port, self.server.effective_api_origin)
        resp = _init(http, self.tok1)
        aid = resp["artifact_id"]
        entered, release = threading.Event(), threading.Event()
        data = b"ttl-bytes"
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        sha = hashlib.sha256(data).hexdigest()
        worker_done = []

        def worker():
            st, _, _ = http.api("PUT", qp, self.tok1, body=data,
                                ctype="application/octet-stream",
                                headers={"X-Chunk-Sha256": sha})
            worker_done.append(st)

        with self._gate_method("_insert_receipt", entered, release):
            worker = threading.Thread(target=worker)
            worker.start()
            self.assertTrue(entered.wait(timeout=10))
            closer = threading.Thread(
                target=lambda: self.server.close(grace_s=1))
            closer.start()
            time.sleep(0.5)  # closer is now waiting on the worker
            self.assertTrue(closer.is_alive())
            release.set()
            closer.join(timeout=25)
            worker.join(timeout=10)
        self.assertFalse(closer.is_alive())
        self.assertEqual(self.server.active_count_for_test(), 0)
        # ownership ordering: the receipt is durable, storage closed after
        from manure.storage import ArtifactStore
        check = ArtifactStore(os.path.join(self.tmp.name, "r7c"))
        try:
            status = check.upload_status(aid)
            self.assertEqual(status["files"][0]["received_bytes"], len(data))
        finally:
            check.close()

    def test_r7_close_orders_after_inflight_publish(self):
        import threading
        self.server.close()
        self.server = create_server(_make_config(
            self.tmp.name, self.users, subdir="r7p", request_timeout_s=20))
        http = _Http(self.server.bound_port, self.server.effective_api_origin)
        resp = _init(http, self.tok1)
        aid = resp["artifact_id"]
        data = b"ttl-bytes"
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        sha = hashlib.sha256(data).hexdigest()
        http.api("PUT", qp, self.tok1, body=data,
                 ctype="application/octet-stream",
                 headers={"X-Chunk-Sha256": sha})
        entered, release = threading.Event(), threading.Event()
        published = []

        def worker():
            body = json.dumps({}).encode()
            st, _, _ = http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                self.tok1, body=body, ctype="application/json")
            published.append(st)

        with self._gate_method("_finish_publish_locked", entered, release):
            worker = threading.Thread(target=worker)
            worker.start()
            self.assertTrue(entered.wait(timeout=10))
            closer = threading.Thread(
                target=lambda: self.server.close(grace_s=1))
            closer.start()
            time.sleep(0.5)
            release.set()
            closer.join(timeout=25)
            worker.join(timeout=10)
        self.assertFalse(closer.is_alive())
        from manure.storage import ArtifactStore
        check = ArtifactStore(os.path.join(self.tmp.name, "r7p"))
        try:
            self.assertEqual(check.get_artifact(aid)["state"], "ready")
        finally:
            check.close()

    def test_r7_close_waits_sweeper_and_streaming(self):
        import threading
        from unittest import mock
        self.server.close()
        self.server = create_server(_make_config(
            self.tmp.name, self.users, subdir="r7s", request_timeout_s=20,
            sweep_interval_s=1))
        http = _Http(self.server.bound_port, self.server.effective_api_origin)
        # gate the PERIODIC sweeper thread itself, then close around it
        entered, release = threading.Event(), threading.Event()
        real_sweep = self.server._store.sweep
        exited = []

        def slow_sweep(*args, **kwargs):
            entered.set()
            release.wait(timeout=20)
            try:
                return real_sweep(*args, **kwargs)
            finally:
                exited.append(True)

        with mock.patch.object(self.server._store, "sweep",
                               side_effect=slow_sweep):
            self.assertTrue(entered.wait(timeout=10))
            closer = threading.Thread(
                target=lambda: self.server.close(grace_s=1))
            closer.start()
            time.sleep(0.4)
            self.assertTrue(closer.is_alive())  # waiting on the sweep
            release.set()
            closer.join(timeout=25)
        self.assertFalse(closer.is_alive())
        self.assertTrue(exited)  # in-flight sweep finished before close
        self.assertFalse(self.server._sweeper.is_alive())
        # streaming download interrupted by close: close stays bounded
        self.server.close()
        self.server = create_server(_make_config(
            self.tmp.name, self.users, subdir="r7t", request_timeout_s=20))
        http = _Http(self.server.bound_port, self.server.effective_api_origin)
        data = b"s" * (2 * 1024 * 1024)
        files = [{"path": "big.bin", "kind": "file", "size": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}]
        payload = {"name": "n", "kind": "file", "visibility": "public",
                   "files": files}
        body = json.dumps(payload).encode()
        st, _, raw = http.api("POST", "/api/v1/artifacts:init", self.tok1,
                               body=body, ctype="application/json")
        aid = json.loads(raw)["artifact_id"]
        for off in (0, 1048576):
            qp = "/api/v1/artifacts/%s/chunks?path=big.bin&offset=%d" % (aid,
                                                                          off)
            http.api("PUT", qp, self.tok1, body=data[off:off + 1048576],
                     ctype="application/octet-stream",
                     headers={"X-Chunk-Sha256":
                              hashlib.sha256(data[off:off + 1048576]).hexdigest()})
        body = json.dumps({}).encode()
        http.api("POST", "/api/v1/artifacts/%s/publish" % aid, self.tok1,
                 body=body, ctype="application/json")
        import socket as _socket
        sock = _socket.create_connection(("127.0.0.1", http.port),
                                         timeout=10)
        sock.sendall(("GET /api/v1/artifacts/%s/files/big.bin/content "
                      "HTTP/1.1\r\nHost: %s\r\n\r\n"
                      % (aid, http.api_host)).encode())
        time.sleep(0.4)  # streaming worker mid-response
        started = time.time()
        self.server.close(grace_s=1)
        self.assertLess(time.time() - started, 15)
        self.assertEqual(self.server.active_count_for_test(), 0)
        try:
            sock.close()
        except OSError:
            pass

    # -- R7 fail-closed shutdown --------------------------------------------------
    def test_r7_stuck_worker_close_raises_and_retains_ownership(self):
        # Worker held beyond all deadlines: close() must raise WITHOUT
        # releasing ownership; successor denied until the worker terminates.
        import threading
        from manure.storage import StorageError
        self.server.close()
        self.server = create_server(_make_config(
            self.tmp.name, self.users, subdir="r7stuck",
            request_timeout_s=20))
        http = _Http(self.server.bound_port, self.server.effective_api_origin)
        resp = _init(http, self.tok1)
        aid = resp["artifact_id"]
        entered, release = threading.Event(), threading.Event()
        data = b"ttl-bytes"
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        sha = hashlib.sha256(data).hexdigest()

        def worker():
            try:
                http.api("PUT", qp, self.tok1, body=data,
                         ctype="application/octet-stream",
                         headers={"X-Chunk-Sha256": sha})
            except Exception:
                pass

        with self._gate_method("_insert_receipt", entered, release):
            worker_thread = threading.Thread(target=worker)
            worker_thread.start()
            self.assertTrue(entered.wait(timeout=10))
            errors: list = []

            def do_close():
                try:
                    self.server.close(grace_s=0.5)
                except Exception as exc:  # noqa: BLE001
                    errors.append(exc)

            closer = threading.Thread(target=do_close)
            closer.start()
            closer.join(timeout=30)
            self.assertFalse(closer.is_alive())
            # fail-closed: close raised, ownership retained
            self.assertEqual(len(errors), 1)
            self.assertIsInstance(errors[0], StorageError)
            with self.assertRaises(StorageError):
                create_server(_make_config(
                    self.tmp.name, self.users, subdir="r7stuck"))
            # old worker terminates -> retry close succeeds -> successor works
            release.set()
            worker_thread.join(timeout=10)
            self.server.close(grace_s=1)
            successor = create_server(_make_config(
                self.tmp.name, self.users, subdir="r7stuck"))
            self.addCleanup(lambda: successor.close())
            http2 = _Http(successor.bound_port,
                          successor.effective_api_origin)
            st, _, _ = http2.api("GET", "/api/v1/health", None,
                                  origin=None)
            self.assertEqual(st, 200)

    # -- R16 ------------------------------------------------------------------
    def test_r16_sweeper_and_handler_faults_hide_canaries(self):
        import io
        from contextlib import redirect_stderr
        from unittest import mock
        from manure.server import _Handler, _run_sweep_once
        canary = "canary-path-/srv/secret-%s" % authmod.generate_token()[:8]
        # one real sweeper iteration against a faulting store
        log2 = io.StringIO()
        def boom(*args, **kwargs):
            raise RuntimeError(canary)
        with redirect_stderr(log2):
            with mock.patch.object(self.server._store, "sweep",
                                   side_effect=boom):
                _run_sweep_once(self.server._store)
        out2 = log2.getvalue()
        self.assertNotIn(canary, out2)
        self.assertNotIn("Traceback", out2)
        self.assertIn("sweeper-fault RuntimeError", out2)
        # handler error path: no traceback, no canary
        log3 = io.StringIO()
        with redirect_stderr(log3):
            with mock.patch.object(
                    _Handler, "handle_one_request",
                    side_effect=RuntimeError(canary)):
                import socket as _socket
                sock = _socket.create_connection(("127.0.0.1",
                                                  self.http.port), timeout=10)
                try:
                    sock.sendall(("GET /api/v1/health HTTP/1.1\r\nHost: %s\r\n"
                                  "\r\n" % self.http.api_host).encode())
                    sock.settimeout(3)
                    try:
                        sock.recv(65536)
                    except (OSError, _socket.timeout):
                        pass
                finally:
                    sock.close()
                time.sleep(0.3)
        out = log3.getvalue()
        self.assertNotIn(canary, out)
        self.assertNotIn("Traceback", out)


class ConfigCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        u1, self.tok1 = _mint(self.tmp.name, "u1", "t1")
        self.users = [u1]

    def _base(self, **overrides):
        cfg = {
            "data_dir": os.path.join(self.tmp.name, "data"),
            "port": 0,
            "api_origin": "http://127.0.0.1:0",
            "content_suffix": "artifacts.localhost",
            "loopback_dev": True,
            "dashboard_dir": None,
            "unlock_shell_dir": None,
            "users": self.users,
        }
        cfg.update(overrides)
        return cfg

    def test_unknown_keys_fail_closed(self):
        from manure.domain import DomainError
        with self.assertRaises(DomainError):
            ServerConfig.from_dict({**self._base(), "nope": 1})

    def test_users_required_and_chunk_range(self):
        from manure.domain import DomainError
        with self.assertRaises(DomainError):
            ServerConfig.from_dict({**self._base(), "users": []})
        with self.assertRaises(DomainError):
            ServerConfig.from_dict({**self._base(), "chunk_bytes": 1024})
        with self.assertRaises(DomainError):
            ServerConfig.from_dict({**self._base(), "loopback_dev": False,
                                    "api_origin": "http://x:0"})

    def test_dashboard_disabled_and_assets(self):
        server = create_server(ServerConfig.from_dict(self._base()))
        self.addCleanup(lambda: server.close())
        http = _Http(server.bound_port, server.effective_api_origin)
        st, _, raw = http.api("GET", "/", self.tok1, origin=None)
        self.assertEqual(st, 404)
        self.assertEqual(json.loads(raw)["error"]["code"],
                         "dashboard-disabled")
        # configured dashboard dir serves shell + assets with UI CSP header
        dash = os.path.join(self.tmp.name, "dash")
        os.makedirs(dash)
        with open(os.path.join(dash, "index.html"), "w") as fh:
            fh.write("<html>dash</html>")
        with open(os.path.join(dash, "app.js"), "w") as fh:
            fh.write("console.log(1)")
        server.close()
        server = create_server(ServerConfig.from_dict(
            {**self._base(), "dashboard_dir": dash,
             "data_dir": os.path.join(self.tmp.name, "data2")}))
        self.addCleanup(lambda: server.close())
        http = _Http(server.bound_port, server.effective_api_origin)
        st, hdrs, got = http.api("GET", "/", self.tok1, origin=None)
        self.assertEqual(st, 200)
        self.assertIn(b"dash", got)
        csp = hdrs.get("Content-Security-Policy", "")
        self.assertIn("artifacts.localhost", csp)
        self.assertIn("form-action", csp)
        # wildcard carries the effective non-default content port
        self.assertIn("http://*.artifacts.localhost:%d" % http.port, csp)
        st, _, got = http.api("GET", "/app.js", self.tok1, origin=None)
        self.assertEqual(st, 200)
        self.assertIn(b"console.log", got)
        # traversal escapes the shell dir
        st, _, _ = http.api("GET", "/../x", self.tok1, origin=None)
        self.assertIn(st, (400, 404))

    # -- UI browser-fixture compatibility --------------------------------------
    def test_direct_dataclass_construction_compat(self):
        # Mirrors manure/tests/browser_fixtures.py: UserConfig/TokenRef
        # objects passed straight into ServerConfig(**kwargs).
        from manure import auth as _auth
        from manure.domain import ServerConfig, TokenRef, UserConfig
        token = _auth.generate_token()
        digest = _auth.sha256_hex(token)
        hf = os.path.join(self.tmp.name, "b.hash")
        with open(hf, "w", encoding="ascii") as fh:
            fh.write(digest + "\n")
        users = (UserConfig(id="browser", type="human",
                            tokens=(TokenRef(id="tok",
                                             hash_file=hf),),
                            display_name="browser test human"),)
        cfg = ServerConfig(
            data_dir=os.path.join(self.tmp.name, "uidata"),
            api_origin="http://dashboard.artifacts.localhost:0",
            content_suffix="artifacts.localhost",
            loopback_dev=True, port=0, dashboard_dir=None,
            unlock_shell_dir=None, users=users)
        server = create_server(cfg)
        try:
            self.assertTrue(server.effective_api_origin.startswith(
                "http://dashboard.artifacts.localhost:"))
            self.assertIn(".artifacts.localhost",
                          server.content_url("0" * 32))
            http = _Http(server.bound_port, server.effective_api_origin)
            st, _, _ = http.api("GET", "/api/v1/health", None, origin=None)
            # Host gate: dashboard host serves; sibling content host routes
            self.assertEqual(st, 200)
        finally:
            server.close()

    # -- R9 competing server ------------------------------------------------
    def test_r9_competing_server_same_data_dir(self):
        from manure.storage import StorageError
        holder = create_server(ServerConfig.from_dict(self._base()))
        try:
            http = _Http(holder.bound_port, holder.effective_api_origin)
            with self.assertRaises(StorageError) as ctx:
                create_server(ServerConfig.from_dict(self._base()))
            self.assertEqual(ctx.exception.code, "unavailable")
            # holder serves unaffected by the failed competitor
            st, _, _ = http.api("GET", "/api/v1/health", None, origin=None)
            self.assertEqual(st, 200)
        finally:
            holder.close()
        # claim released: successor starts on the same data_dir
        successor = create_server(ServerConfig.from_dict(self._base()))
        successor.close()

    # -- R12 ----------------------------------------------------------------
    def test_r12_direct_construction_validated(self):
        from manure.domain import DomainError, ServerConfig, UserConfig
        good = self._base()
        users = good["users"]
        # empty users rejected on direct construction too
        with self.assertRaises(DomainError):
            ServerConfig(data_dir=good["data_dir"],
                         api_origin=good["api_origin"],
                         content_suffix=good["content_suffix"],
                         loopback_dev=True, users=[])
        # non-boolean loopback_dev (truthy "false" string) rejected
        with self.assertRaises(DomainError):
            ServerConfig.from_dict({**good, "loopback_dev": "false"})
        # duplicate user / token ids rejected
        with self.assertRaises(DomainError):
            ServerConfig.from_dict({**good, "users": users + users})
        dup_tok = [dict(users[0])]
        dup_tok[0]["tokens"] = list(users[0]["tokens"]) * 2
        with self.assertRaises(DomainError):
            ServerConfig.from_dict({**good, "users": dup_tok})
        # bad origins / suffixes rejected
        for bad_origin in ("http://example.com", "https://user@h",
                           "https://h/path", "notaurl"):
            with self.assertRaises(DomainError, msg=bad_origin):
                ServerConfig.from_dict({**good, "loopback_dev": False,
                                        "api_origin": bad_origin})
        # R12: remote https + loopback_dev is rejected (JSON + direct),
        # as is a non-loopback content suffix under loopback_dev.
        remote = {**good, "loopback_dev": True,
                  "api_origin": "https://artifacts.example:443"}
        with self.assertRaises(DomainError):
            ServerConfig.from_dict(remote)
        with self.assertRaises(DomainError):
            ServerConfig(loopback_dev=True,
                         data_dir=good["data_dir"],
                         api_origin="https://artifacts.example",
                         content_suffix=good["content_suffix"],
                         users=good["users"])
        with self.assertRaises(DomainError):
            ServerConfig.from_dict({**good, "content_suffix":
                                    "example.com"})
        with self.assertRaises(DomainError):
            ServerConfig.from_dict({**good, "content_suffix": "bad suffix!"})
        # strict hash files: uppercase / CRLF / trailing space rejected
        import tempfile as _tf
        for content in (b"AB" * 32 + b"\n", b"ab" * 32 + b"\r\n",
                        b"ab" * 32 + b" \n", b"ab" * 32 + b"\n\n"):
            with _tf.NamedTemporaryFile(delete=False,
                                         dir=self.tmp.name) as fh:
                fh.write(content)
                p = fh.name
            with self.assertRaises(Exception, msg=repr(content)):
                from manure import auth as _a
                _a.load_hash_file(p)
        _ = UserConfig

    def test_production_cookie_names_and_secure(self):
        cfg = self._base(loopback_dev=False,
                         api_origin="https://127.0.0.1:0")
        server = create_server(ServerConfig.from_dict(cfg))
        self.addCleanup(lambda: server.close())
        origin = "https://127.0.0.1:%d" % server.bound_port
        http = _Http(server.bound_port, origin)
        xfp = {"X-Forwarded-Proto": "https"}
        body = json.dumps({"token": self.tok1}).encode()
        st, hdrs, _ = http.api("POST", "/api/v1/login", None,
                                body=body, ctype="application/json",
                                headers=xfp)
        self.assertEqual(st, 200)
        set_cookie = hdrs.get("Set-Cookie", "")
        self.assertIn("__Host-manure=", set_cookie)
        self.assertIn("Secure", set_cookie)
        self.assertIn("SameSite=Strict", set_cookie)
        self.assertNotIn("Domain=", set_cookie)


if __name__ == "__main__":
    unittest.main()
