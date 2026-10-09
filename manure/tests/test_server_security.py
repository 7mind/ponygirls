"""F3/F4/visibilities/auth/cookies/Origin/Host/TLS/headers spec (server owned).

Same fixture as test_server_lifecycle (see its header). Real temporary
SQLite/FS/loopback only; stdlib HTTP with explicit Host headers.
"""

import hashlib
import http.client
import json
import os
import tempfile
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
        out = dict(resp.getheaders())
        status = resp.status
        conn.close()
        return status, out, data

    def api(self, method, path, token=None, cookie=None, origin="present", **kw):
        headers = dict(kw.pop("headers", {}) or {})
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        if cookie is not None:
            headers["Cookie"] = cookie
        if origin == "present":
            headers["Origin"] = self.api_origin
        elif origin is not None:
            headers["Origin"] = origin
        return self.request(method, path, self.api_host, headers=headers, **kw)

    def content(self, artifact_id, method, path, **kw):
        host = "%s.artifacts.localhost:%d" % (artifact_id, self.port)
        return self.request(method, path, host, **kw)


def _init(http, token, visibility="internal", kind="file", data=b"sec-data",
          path="f.bin"):
    files = [{"path": path, "kind": "file", "size": len(data),
              "sha256": hashlib.sha256(data).hexdigest()}]
    body = json.dumps({"name": "n", "kind": kind, "visibility": visibility,
                       "files": files}).encode()
    st, _, raw = http.api("POST", "/api/v1/artifacts:init", token,
                          body=body, ctype="application/json")
    assert st == 200, raw[:300]
    aid = json.loads(raw)["artifact_id"]
    qp = "/api/v1/artifacts/%s/chunks?path=%s&offset=0" % (
        aid, urllib.parse.quote(path, safe=""))
    st, _, raw = http.api(
        "PUT", qp, token, body=data, ctype="application/octet-stream",
        headers={"X-Chunk-Sha256": hashlib.sha256(data).hexdigest()})
    assert st == 200, raw[:300]
    body = json.dumps({}).encode()
    st, _, raw = http.api("POST", "/api/v1/artifacts/%s/publish" % aid, token,
                          body=body, ctype="application/json")
    assert st == 200, raw[:300]
    return aid


def _handoff_cookie(http, aid, token):
    body = json.dumps({}).encode()
    st, _, raw = http.api("POST", "/api/v1/artifacts/%s/grants" % aid, token,
                          body=body, ctype="application/json")
    assert st == 200, raw[:300]
    grant = json.loads(raw)["grant"]
    gbody = urllib.parse.urlencode({"grant": grant}).encode()
    st, hdrs, _ = http.content(aid, "POST", "/__manure/grant", body=gbody,
                               ctype="application/x-www-form-urlencoded",
                               headers={"Origin": http.api_origin})
    assert st == 303, (st, hdrs)
    return hdrs["Set-Cookie"].split(";", 1)[0]


class SecurityCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        u1, self.tok1 = _mint(self.tmp.name, "u1", "t1")
        u2, self.tok2 = _mint(self.tmp.name, "u2", "t2", "human")
        self.users = [u1, u2]
        self.server = create_server(_make_config(self.tmp.name, self.users))
        self.addCleanup(lambda: self.server.close())
        self.http = _Http(self.server.bound_port,
                          self.server.effective_api_origin)

    # -- F3 visibilities ----------------------------------------------
    def test_internal_authed_ok_anon_denied(self):
        aid = _init(self.http, self.tok1, visibility="internal")
        st, _, _ = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % aid, None,
            origin=None)
        self.assertEqual(st, 401)
        st, _, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % aid,
            self.tok1, origin=None)
        self.assertEqual(st, 200)
        self.assertEqual(got, b"sec-data")
        # content host without grant -> 401 grant-required, never bytes
        st, _, raw = self.http.content(aid, "GET", "/f.bin")
        self.assertEqual(st, 401)
        self.assertEqual(json.loads(raw)["error"]["code"], "grant-required")
        # with handoff grant cookie -> 200 inline
        cookie = _handoff_cookie(self.http, aid, self.tok1)
        st, hdrs, got = self.http.content(aid, "GET", "/f.bin",
                                          headers={"Cookie": cookie})
        self.assertEqual(st, 200)
        self.assertEqual(got, b"sec-data")
        self.assertNotIn("attachment", hdrs.get("Content-Disposition", ""))

    def test_external_password_flow_and_rotation(self):
        data = b"ext-bytes"
        files = [{"path": "f.bin", "kind": "file", "size": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}]
        body = json.dumps({"name": "n", "kind": "file",
                           "visibility": "external",
                           "files": files}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts:init",
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 200)
        resp = json.loads(raw)
        aid, password = resp["artifact_id"], resp["external_password"]
        self.assertEqual(len(password), 43)
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        self.http.api("PUT", qp, self.tok1, body=data,
                      ctype="application/octet-stream",
                      headers={"X-Chunk-Sha256": hashlib.sha256(data).hexdigest()})
        body = json.dumps({}).encode()
        self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                      self.tok1, body=body, ctype="application/json")
        # password appears NOWHERE else: info/list/files/manifest-less reads
        for path in ("/api/v1/artifacts/%s" % aid,
                     "/api/v1/artifacts/%s/files" % aid,
                     "/api/v1/artifacts"):
            st, _, raw = self.http.api("GET", path, self.tok1, origin=None)
            self.assertEqual(st, 200)
            self.assertNotIn(password, raw.decode())
        # API byte reads need auth even for external
        st, _, _ = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % aid, None,
            origin=None)
        self.assertEqual(st, 401)
        # content without grant -> password form 200 (no secret in it)
        st, _, form = self.http.content(aid, "GET", "/")
        self.assertEqual(st, 200)
        self.assertNotIn(password, form.decode(errors="replace"))
        # wrong password -> 401, no cookie
        bad = json.dumps({"password": "x" * 43}).encode()
        origin = "http://%s.artifacts.localhost:%d" % (aid, self.http.port)
        st, hdrs, raw = self.http.content(aid, "POST", "/__manure/unlock",
                                          body=bad, ctype="application/json",
                                          headers={"Origin": origin})
        self.assertEqual(st, 401)
        self.assertNotIn("Set-Cookie", hdrs)
        self.assertEqual(json.loads(raw)["error"]["code"], "password-invalid")
        # right password (JSON) -> 200 + grant cookie
        good = json.dumps({"password": password}).encode()
        st, hdrs, _ = self.http.content(aid, "POST", "/__manure/unlock",
                                        body=good, ctype="application/json",
                                        headers={"Origin": origin})
        self.assertEqual(st, 200)
        cookie = hdrs["Set-Cookie"].split(";", 1)[0]
        self.assertNotIn(password, hdrs["Set-Cookie"])
        st, _, got = self.http.content(aid, "GET", "/f.bin",
                                       headers={"Cookie": cookie})
        self.assertEqual(st, 200)
        self.assertEqual(got, data)
        # authorized manifest carries hashes (token-free external download)
        st, _, raw = self.http.content(aid, "GET", "/__manure/manifest",
                                       headers={"Cookie": cookie})
        self.assertEqual(st, 200)
        self.assertIn("sha256", raw.decode())
        # rotate (any authed user, here u2) -> new password once, old dead
        body = json.dumps({}).encode()
        st, _, raw = self.http.api(
            "POST", "/api/v1/artifacts/%s/external-password:rotate" % aid,
            self.tok2, body=body, ctype="application/json")
        self.assertEqual(st, 200, raw[:200])
        new_password = json.loads(raw)["external_password"]
        self.assertNotEqual(new_password, password)
        # old grant cookie killed by rotation: locked deep path is 404
        # (F2: never form HTML); the entry point still serves the form.
        st, _, got = self.http.content(aid, "GET", "/f.bin",
                                       headers={"Cookie": cookie})
        self.assertEqual(st, 404)
        self.assertNotIn(data, got)
        st, _, form = self.http.content(aid, "GET", "/",
                                        headers={"Cookie": cookie})
        self.assertEqual(st, 200)
        self.assertNotIn(data, form)
        st, _, raw = self.http.content(aid, "GET", "/__manure/manifest",
                                       headers={"Cookie": cookie})
        self.assertEqual(st, 401)
        self.assertEqual(json.loads(raw)["error"]["code"],
                         "grant-required")
        # old password rejected
        st, _, _ = self.http.content(aid, "POST", "/__manure/unlock",
                                     body=good, ctype="application/json",
                                     headers={"Origin": origin})
        self.assertEqual(st, 401)

    def test_public_anon_ok(self):
        aid = _init(self.http, self.tok1, visibility="public")
        st, _, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % aid, None,
            origin=None)
        self.assertEqual(st, 200)
        self.assertEqual(got, b"sec-data")
        st, _, got = self.http.content(aid, "GET", "/f.bin")
        self.assertEqual(st, 200)
        self.assertEqual(got, b"sec-data")

    def test_grants_rejected_for_external_and_public(self):
        aid = _init(self.http, self.tok1, visibility="public")
        body = json.dumps({}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/grants" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 400)
        self.assertEqual(json.loads(raw)["error"]["code"],
                         "invalid-visibility")

    # -- F4 shared-user matrix -----------------------------------------
    def test_every_user_lists_inspects_deletes(self):
        aid = _init(self.http, self.tok1)
        st, _, _ = self.http.api("GET", "/api/v1/artifacts", self.tok2,
                                 origin=None)
        self.assertEqual(st, 200)
        st, _, _ = self.http.api("GET", "/api/v1/artifacts/%s" % aid,
                                 self.tok2, origin=None)
        self.assertEqual(st, 200)
        st, _, _ = self.http.api("DELETE", "/api/v1/artifacts/%s" % aid,
                                 self.tok2)
        self.assertEqual(st, 200)
        st, _, _ = self.http.api("GET", "/api/v1/artifacts/%s" % aid,
                                 self.tok1, origin=None)
        self.assertEqual(st, 404)

    def test_incomplete_mutation_owner_only(self):
        data = b"own"
        files = [{"path": "f.bin", "kind": "file", "size": 3,
                  "sha256": hashlib.sha256(data).hexdigest()}]
        body = json.dumps({"name": "n", "kind": "file",
                           "visibility": "internal",
                           "files": files}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts:init",
                                   self.tok1, body=body,
                                   ctype="application/json")
        aid = json.loads(raw)["artifact_id"]
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        st, _, raw = self.http.api(
            "PUT", qp, self.tok2, body=data,
            ctype="application/octet-stream",
            headers={"X-Chunk-Sha256": hashlib.sha256(data).hexdigest()})
        self.assertEqual(st, 403)
        self.assertEqual(json.loads(raw)["error"]["code"], "session-not-owned")
        body = json.dumps({}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.tok2, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 403)
        # PATCH while uploading: owner-only
        patch = json.dumps({"name": "renamed"}).encode()
        st, _, _ = self.http.api("PATCH", "/api/v1/artifacts/%s" % aid,
                                 self.tok2, body=patch,
                                 ctype="application/json")
        self.assertEqual(st, 403)
        # owner completes; PATCH once ready: any user ok
        self.http.api("PUT", qp, self.tok1, body=data,
                      ctype="application/octet-stream",
                      headers={"X-Chunk-Sha256": hashlib.sha256(data).hexdigest()})
        body = json.dumps({}).encode()
        self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                      self.tok1, body=body, ctype="application/json")
        patch = json.dumps({"name": "renamed"}).encode()
        st, _, raw = self.http.api("PATCH", "/api/v1/artifacts/%s" % aid,
                                   self.tok2, body=patch,
                                   ctype="application/json")
        self.assertEqual(st, 200, raw[:200])

    # -- auth mechanics -------------------------------------------------
    # -- R17 canonical token codec -------------------------------------------
    def test_r17_noncanonical_provisioned_digest_never_authenticates(self):
        # R17: exact wire credentials. First, padded variants of the
        # currently provisioned valid token must fail (no normalization),
        # for Bearer and dashboard/content cookies.
        for padded in (" " + self.tok1, self.tok1 + " ",
                       " " + self.tok1 + " ", "\t" + self.tok1):
            st, _, _ = self.http.api("GET", "/api/v1/whoami",
                                      padded, origin=None)
            self.assertEqual(st, 401, repr(padded))
        body = json.dumps({"token": self.tok1}).encode()
        st, hdrs, _ = self.http.api("POST", "/api/v1/login", None,
                                     body=body, ctype="application/json")
        self.assertEqual(st, 200)
        session = hdrs["Set-Cookie"].split(";", 1)[0]
        sname, _, svalue = session.partition("=")
        for padded_cookie in (
                sname + "= " + svalue,
                session + " ",
                sname + '="' + svalue + '"'):
            st, _, _ = self.http.api("GET", "/api/v1/whoami", None,
                                      cookie=padded_cookie,
                                      origin=self.http.api_origin)
            self.assertEqual(st, 401, repr(padded_cookie))
        # Content grant cookie: padded variants must not authorize.
        aid = _init(self.http, self.tok1, visibility="internal")
        grant_cookie = _handoff_cookie(self.http, aid, self.tok1)
        gname, _, gvalue = grant_cookie.partition("=")
        st, _, _ = self.http.content(aid, "GET", "/f.bin",
                                     headers={"Cookie": grant_cookie})
        self.assertEqual(st, 200)
        for padded_grant in (gname + "= " + gvalue,
                             grant_cookie + " ",
                             gname + '="' + gvalue + '"'):
            st, _, _ = self.http.content(
                aid, "GET", "/f.bin",
                headers={"Cookie": padded_grant})
            self.assertIn(st, (401, 403), repr(padded_grant))
        # 42 'A's + 'B': 43 base64url chars but non-zero pad bits, hence
        # not a canonical 32-byte encoding. Provision its digest anyway.
        evil = "A" * 42 + "B"
        self.assertFalse(authmod.is_canonical_token(evil))
        digest = authmod.sha256_hex(evil)
        path = os.path.join(self.tmp.name, "evil.hash")
        with open(path, "w", encoding="ascii") as fh:
            fh.write(digest + "\n")
        users = [{"id": "victim", "type": "agent",
                  "tokens": [{"id": "t", "hashFile": path}]}]
        self.server.close()
        self.server = create_server(_make_config(self.tmp.name, users))
        self.http = _Http(self.server.bound_port,
                          self.server.effective_api_origin)
        for origin in (None, self.http.api_origin):
            st, _, _ = self.http.api("GET", "/api/v1/whoami", evil,
                                      origin=origin)
            self.assertEqual(st, 401, origin)
        body = json.dumps({"token": evil}).encode()
        st, _, _ = self.http.api("POST", "/api/v1/login", None,
                                  body=body, ctype="application/json")
        self.assertEqual(st, 401)

    def test_r17_noncanonical_token_file_rejected(self):
        for content in (b"A" * 42 + b"B\n", b"A" * 42 + b"\n",
                        b"A" * 44 + b"\n"):
            path = os.path.join(self.tmp.name, "nc-%d.hash" % len(content))
            with open(path, "wb") as fh:
                fh.write(content)
            with self.assertRaises(Exception, msg=repr(content)):
                authmod.load_token_file(path)

    def test_ambiguous_credentials_no_side_effects(self):
        body = json.dumps({}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/logout", self.tok1,
                                   cookie="manure-dev=whatever",
                                   body=body, ctype="application/json")
        self.assertEqual(st, 400)
        self.assertEqual(json.loads(raw)["error"]["code"],
                         "ambiguous-credentials")
        # token still valid afterwards
        st, _, _ = self.http.api("GET", "/api/v1/whoami", self.tok1,
                                 origin=None)
        self.assertEqual(st, 200)

    def test_login_requires_exact_origin_and_sets_dev_cookie(self):
        body = json.dumps({"token": self.tok1}).encode()
        st, hdrs, _ = self.http.api("POST", "/api/v1/login", None,
                                    origin=None, body=body,
                                    ctype="application/json")
        self.assertEqual(st, 403)
        self.assertNotIn("Set-Cookie", hdrs)
        st, hdrs, _ = self.http.api("POST", "/api/v1/login", None,
                                    origin="http://evil.example",
                                    body=body, ctype="application/json")
        self.assertEqual(st, 403)
        self.assertNotIn("Set-Cookie", hdrs)
        st, hdrs, raw = self.http.api("POST", "/api/v1/login", None,
                                      body=body, ctype="application/json")
        self.assertEqual(st, 200, raw[:200])
        set_cookie = hdrs.get("Set-Cookie", "")
        self.assertIn("manure-dev=", set_cookie)
        self.assertNotIn("Domain=", set_cookie)
        self.assertIn("HttpOnly", set_cookie)
        self.assertIn("SameSite=Strict", set_cookie)
        who = json.loads(raw)
        self.assertEqual(who["user_id"], "u1")
        # cookie authenticates; cookie mutation without Origin rejected
        cookie = set_cookie.split(";", 1)[0]
        st, _, _ = self.http.api("GET", "/api/v1/whoami", None,
                                 cookie=cookie, origin=None)
        self.assertEqual(st, 200)
        body = json.dumps({}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/logout", None,
                                   cookie=cookie, origin=None,
                                   body=body, ctype="application/json")
        self.assertEqual(st, 403)
        self.assertEqual(json.loads(raw)["error"]["code"], "forbidden")
        st, _, _ = self.http.api("POST", "/api/v1/logout", None,
                                 cookie=cookie, body=body,
                                 ctype="application/json")
        self.assertEqual(st, 200)

    def test_bearer_allows_absent_origin_rejects_mismatch(self):
        st, _, _ = self.http.api("GET", "/api/v1/whoami", self.tok1,
                                 origin=None)
        self.assertEqual(st, 200)
        st, _, raw = self.http.api("GET", "/api/v1/whoami", self.tok1,
                                   origin="http://evil.example")
        self.assertEqual(st, 403)
        self.assertEqual(json.loads(raw)["error"]["code"], "forbidden")

    def test_single_use_grant_and_wrong_origin(self):
        aid = _init(self.http, self.tok1)
        body = json.dumps({}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/grants" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        grant = json.loads(raw)["grant"]
        gbody = urllib.parse.urlencode({"grant": grant}).encode()
        st, _, _ = self.http.content(aid, "POST", "/__manure/grant",
                                     body=gbody,
                                     ctype="application/x-www-form-urlencoded",
                                     headers={"Origin": "http://evil.example"})
        self.assertEqual(st, 403)
        st, hdrs, _ = self.http.content(
            aid, "POST", "/__manure/grant", body=gbody,
            ctype="application/x-www-form-urlencoded",
            headers={"Origin": self.http.api_origin})
        self.assertEqual(st, 303)
        # replay single-use grant -> rejected
        st, _, raw = self.http.content(
            aid, "POST", "/__manure/grant", body=gbody,
            ctype="application/x-www-form-urlencoded",
            headers={"Origin": self.http.api_origin})
        self.assertEqual(st, 403)
        self.assertIn(json.loads(raw)["error"]["code"],
                      ("grant-invalid", "grant-expired"))

    def test_content_host_rejects_api_and_unknown(self):
        aid = _init(self.http, self.tok1)
        st, _, raw = self.http.content(aid, "GET", "/api/v1/health")
        self.assertEqual(st, 404)
        self.assertEqual(json.loads(raw)["error"]["code"], "not-found")
        st, _, raw = self.http.content(aid, "GET", "/__manure/nope")
        self.assertEqual(st, 404)

    # -- final-contract unknown-field rejection --------------------------------
    def test_unknown_init_top_level_field_rejected(self):
        body = json.dumps({"name": "n", "kind": "dir",
                           "visibility": "internal", "files": [],
                           "manifest": []}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts:init",
                                    self.tok1, body=body,
                                    ctype="application/json")
        self.assertEqual(st, 400)
        self.assertEqual(json.loads(raw)["error"]["code"], "bad-envelope")

    def test_unknown_patch_field_rejected(self):
        aid = _init(self.http, self.tok1, visibility="internal")
        for payload in ({"kind": "file"}, {"manifest": []},
                        {"artifact_id": aid}, {"name": "x", "bogus": 1}):
            body = json.dumps(payload).encode()
            st, _, raw = self.http.api("PATCH", "/api/v1/artifacts/%s" % aid,
                                       self.tok1, body=body,
                                       ctype="application/json")
            self.assertEqual(st, 400, payload)
            self.assertEqual(json.loads(raw)["error"]["code"], "bad-envelope")
        # permitted fields still work
        body = json.dumps({"name": "renamed"}).encode()
        st, _, raw = self.http.api("PATCH", "/api/v1/artifacts/%s" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 200, raw[:200])

    def test_dir_entry_with_size_rejected_as_invalid_path(self):
        sha = hashlib.sha256(b"x").hexdigest()
        files = [{"path": "d", "kind": "dir", "size": 3, "sha256": sha}]
        body = json.dumps({"name": "n", "kind": "dir",
                           "visibility": "internal",
                           "files": files}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts:init",
                                    self.tok1, body=body,
                                    ctype="application/json")
        self.assertEqual(st, 400)
        self.assertEqual(json.loads(raw)["error"]["code"], "invalid-path")

    # -- R12 hostile headers + unsupported methods ---------------------------
    def _raw(self, lines):
        import socket as _socket
        sock = _socket.create_connection(("127.0.0.1", self.http.port),
                                         timeout=10)
        sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
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
        return blob.decode("latin-1", "replace")

    def test_r12_duplicate_host_rejected(self):
        text = self._raw(["GET /api/v1/health HTTP/1.1",
                          "Host: %s" % self.http.api_host,
                          "Host: evil.example"])
        self.assertIn(" 400 ", text.split("\r\n", 1)[0])
        self.assertIn("bad-host", text)
        self.assertNotIn("Set-Cookie", text)

    def test_r12_malformed_authorities_rejected(self):
        for host in ("user@%s" % self.http.api_host,
                     "%s:abc" % self.http.api_host,
                     "%s:99999" % self.http.api_host,
                     "has space.example"):
            text = self._raw(["GET /api/v1/health HTTP/1.1",
                              "Host: " + host])
            self.assertIn("bad-host", text, host)

    def test_r12_duplicate_origin_forbidden(self):
        import socket as _socket
        body = json.dumps({"token": self.tok1}).encode()
        sock = _socket.create_connection(("127.0.0.1", self.http.port),
                                         timeout=10)
        req = ("POST /api/v1/login HTTP/1.1\r\nHost: %s\r\n"
               "Origin: %s\r\nOrigin: %s\r\n"
               "Content-Type: application/json\r\nContent-Length: %d\r\n"
               "\r\n" % (self.http.api_host, self.http.api_origin,
                       self.http.api_origin, len(body)))
        sock.sendall(req.encode() + body)
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
        self.assertIn(" 403 ", text.split("\r\n", 1)[0])
        self.assertNotIn("Set-Cookie", text)

    def test_r12_unsupported_method_gated(self):
        # bad Host on an unknown method still yields bad-host...
        text = self._raw(["TRACE /api/v1/health HTTP/1.1",
                          "Host: evil.example"])
        self.assertIn("bad-host", text)
        # ...and a good Host yields a JSON 404 with security headers.
        text = self._raw(["TRACE /api/v1/health HTTP/1.1",
                          "Host: %s" % self.http.api_host])
        self.assertIn(" 404 ", text.split("\r\n", 1)[0])
        self.assertIn("not-found", text)
        self.assertIn("Origin-Agent-Cluster", text)
        self.assertNotIn("<html", text)

    def test_r12_production_port_enforced(self):
        u, tok9 = _mint(self.tmp.name, "u9", "t9")
        import socket as _sockmod
        probe = _sockmod.socket()
        probe.bind(("127.0.0.1", 0))
        free_port = probe.getsockname()[1]
        probe.close()
        cfg = _make_config(self.tmp.name, [u], subdir="portdata",
                           loopback_dev=False, port=free_port,
                           api_origin="https://example.test")
        srv = create_server(cfg)
        self.addCleanup(lambda: srv.close())
        port = srv.bound_port
        import socket as _socket

        def get(host):
            sock = _socket.create_connection(("127.0.0.1", port),
                                             timeout=10)
            sock.sendall(("GET /api/v1/health HTTP/1.1\r\nHost: %s\r\n"
                          "X-Forwarded-Proto: https\r\n\r\n" % host).encode())
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
            return blob.decode("latin-1", "replace")
        # default-port and portless production Hosts pass the gate
        self.assertIn('"ok": true', get("example.test"))
        self.assertIn('"ok": true', get("example.test:443"))
        # unexpected ports never route
        self.assertIn("bad-host", get("example.test:8443"))
        # R12: remote production login requires proxy TLS trust and mints
        # Secure __Host cookies only (never dev names, never plaintext).
        bad_login = self._raw_login(port, "example.test", None)
        self.assertIn("tls-required", bad_login)
        self.assertNotIn("Set-Cookie", bad_login)
        good_login = self._raw_login_token(port, "example.test", tok9)
        self.assertIn("__Host-manure=", good_login)
        self.assertIn("Secure", good_login)
        self.assertNotIn("manure-dev=", good_login)

    # -- D2/F2 UI harness findings -------------------------------------------
    def _external_published(self, shell_dir=None):
        data = b"ui-bytes"
        files = [{"path": "f.bin", "kind": "file", "size": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}]
        cfg_users = self.users
        if shell_dir is not None:
            self.server.close()
            cfg = _make_config(self.tmp.name, cfg_users, subdir="uishell",
                               unlock_shell_dir=shell_dir)
            self.server = create_server(cfg)
            self.http = _Http(self.server.bound_port,
                              self.server.effective_api_origin)
        body = json.dumps({"name": "n", "kind": "file",
                           "visibility": "external",
                           "files": files}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts:init",
                                    self.tok1, body=body,
                                    ctype="application/json")
        self.assertEqual(st, 200, raw[:200])
        aid = json.loads(raw)["artifact_id"]
        password = json.loads(raw)["external_password"]
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        self.http.api("PUT", qp, self.tok1, body=data,
                      ctype="application/octet-stream",
                      headers={"X-Chunk-Sha256":
                               hashlib.sha256(data).hexdigest()})
        body = json.dumps({}).encode()
        self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                      self.tok1, body=body, ctype="application/json")
        return aid, password, data

    def test_d2_referrer_policy_split(self):
        # Precision decision: ONLY dashboard HTML + generated unlock/password
        # HTML use strict-origin (navigational forms need a real Origin);
        # API JSON dynamic and untrusted uploaded bytes stay no-referrer.
        st, hdrs, _ = self.http.api("GET", "/api/v1/health", None,
                                    origin=None)
        self.assertEqual(hdrs.get("Referrer-Policy"), "no-referrer")
        st, _, raw = self.http.api("GET", "/api/v1/whoami", self.tok1,
                                   origin=None)
        self.assertEqual(st, 200)
        aid, _, _ = self._external_published()
        for path in ("/", "/__manure/password"):
            st, hdrs, _ = self.http.content(aid, "GET", path)
            self.assertEqual(st, 200, path)
            self.assertEqual(hdrs.get("Referrer-Policy"), "strict-origin",
                             path)
        # JSON controls stay no-referrer
        origin = "http://%s.artifacts.localhost:%d" % (aid, self.http.port)
        bad = json.dumps({"password": "x" * 43}).encode()
        st, hdrs, _ = self.http.content(aid, "POST", "/__manure/unlock",
                                        body=bad, ctype="application/json",
                                        headers={"Origin": origin})
        self.assertEqual(hdrs.get("Referrer-Policy"), "no-referrer")
        # untrusted uploaded bytes keep no-referrer on both origins
        pub = _init(self.http, self.tok1, visibility="public")
        st, hdrs, _ = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % pub,
            None, origin=None)
        self.assertEqual(hdrs.get("Referrer-Policy"), "no-referrer")
        st, hdrs, _ = self.http.content(pub, "GET", "/f.bin")
        self.assertEqual(hdrs.get("Referrer-Policy"), "no-referrer")

    def test_f2_shell_assets_while_locked(self):
        shell = os.path.join(self.tmp.name, "unlockshell")
        os.makedirs(shell)
        with open(os.path.join(shell, "unlock.js"), "w") as fh:
            fh.write("/* trusted shell */")
        with open(os.path.join(shell, "styles.css"), "w") as fh:
            fh.write("/* trusted styles */")
        aid, _, _ = self._external_published(shell_dir=shell)
        # locked sibling assets serve trusted bytes, not the form
        st, hdrs, got = self.http.content(aid, "GET", "/unlock.js")
        self.assertEqual(st, 200)
        self.assertIn(b"trusted shell", got)
        self.assertNotIn(b"<form", got)
        self.assertEqual(hdrs.get("Cache-Control"), "no-store")
        st, _, got = self.http.content(aid, "GET", "/styles.css")
        self.assertEqual(st, 200)
        self.assertIn(b"trusted styles", got)
        # unknown paths are 404 JSON, never form HTML
        st, _, raw = self.http.content(aid, "GET", "/nope.js")
        self.assertEqual(st, 404)
        self.assertEqual(json.loads(raw)["error"]["code"], "not-found")
        # the entry point still serves the password form
        st, _, form = self.http.content(aid, "GET", "/")
        self.assertEqual(st, 200)
        self.assertIn(b"password", form.lower())
        # no shell leakage across visibilities: internal stays 401
        aid2 = _init(self.http, self.tok1, visibility="internal")
        st, _, _ = self.http.content(aid2, "GET", "/unlock.js")
        self.assertEqual(st, 401)

    @staticmethod
    def _raw_login_token(port, host, token):
        import socket as _socket
        body = json.dumps({"token": token}).encode()
        sock = _socket.create_connection(("127.0.0.1", port), timeout=10)
        req = ("POST /api/v1/login HTTP/1.1\r\nHost: %s\r\n"
               "Content-Type: application/json\r\nContent-Length: %d\r\n" %
               (host, len(body)))
        origin = "https://%s" % host.split(":")[0]
        req += "Origin: %s\r\nX-Forwarded-Proto: https\r\n" % origin
        sock.sendall((req + "\r\n").encode() + body)
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
        return blob.decode("latin-1", "replace")

    @staticmethod
    def _raw_login(port, host, proto):
        import socket as _socket
        body = json.dumps({"token": "0" * 43}).encode()
        sock = _socket.create_connection(("127.0.0.1", port), timeout=10)
        req = ("POST /api/v1/login HTTP/1.1\r\nHost: %s\r\n"
               "Content-Type: application/json\r\nContent-Length: %d\r\n" %
               (host, len(body)))
        # loopback_dev is False here: only trusted proxy proto is secure.
        origin = "https://%s" % host.split(":")[0]
        req += "Origin: %s\r\n" % origin
        if proto is not None:
            req += "X-Forwarded-Proto: %s\r\n" % proto
        sock.sendall((req + "\r\n").encode() + body)
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
        return blob.decode("latin-1", "replace")

    # -- R13 serving check/open replacement ------------------------------------
    def test_r13_live_parent_swap_never_exposes_outside(self):
        aid = _init(self.http, self.tok1, visibility="public")
        live = os.path.join(self.tmp.name, "data", "live", aid)
        outside = os.path.join(self.tmp.name, "outside.bin")
        with open(outside, "wb") as fh:
            fh.write(b"OUTSIDE" * 1000)
        before = os.stat(outside)
        before_sig = (before.st_mtime_ns, before.st_size)
        # phase 1: legitimate dir serves correctly
        st, _, got = self.http.content(aid, "GET", "/f.bin")
        self.assertEqual((st, got), (200, b"sec-data"))
        # phase 2: swap the live root for a symlink mid-traffic; every
        # response is either the pre-swap bytes or a 404 — never outside.
        import shutil as _shutil
        _shutil.rmtree(live)
        os.symlink(self.tmp.name, live)
        for _ in range(25):
            st, _, got = self.http.content(aid, "GET", "/f.bin")
            self.assertEqual(st, 404)
            self.assertNotIn(b"OUTSIDE", got)
        st, _, _ = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % aid,
            None, origin=None)
        self.assertEqual(st, 404)
        after = os.stat(outside)
        self.assertEqual((after.st_mtime_ns, after.st_size), before_sig)
        with open(outside, "rb") as fh:
            self.assertNotIn(b"sec-data", fh.read())
        # top-level live/ symlink: enumeration and serving stay contained
        import shutil as _shutil2
        live_root = os.path.join(self.tmp.name, "data", "live")
        os.unlink(live)
        _shutil2.rmtree(live_root, ignore_errors=True)
        os.symlink(self.tmp.name, live_root)
        st, _, got = self.http.content(aid, "GET", "/f.bin")
        self.assertEqual(st, 404)
        self.assertNotIn(b"OUTSIDE", got)
        after = os.stat(outside)
        self.assertEqual((after.st_mtime_ns, after.st_size), before_sig)

    def test_bad_host_sets_no_cookies(self):
        conn = http.client.HTTPConnection("127.0.0.1",
                                          self.http.port, timeout=10)
        conn.putrequest("GET", "/api/v1/health", skip_host=True)
        conn.putheader("Host", "evil.example")
        conn.endheaders()
        resp = conn.getresponse()
        raw = resp.read()
        hdrs = dict(resp.getheaders())
        conn.close()
        self.assertIn(resp.status, (400, 404))
        self.assertEqual(json.loads(raw)["error"]["code"], "bad-host")
        self.assertNotIn("Set-Cookie", hdrs)

    def test_tls_required_without_proxy_proto(self):
        u, tok = _mint(self.tmp.name, "u9", "t9")
        cfg = _make_config(self.tmp.name, [u], subdir="tlsdata",
                           loopback_dev=False,
                           api_origin="https://127.0.0.1:0")
        srv = create_server(cfg)
        self.addCleanup(srv.close)
        h2 = _Http(srv.bound_port, "https://127.0.0.1:%d" % srv.bound_port)
        st, _, raw = h2.api("GET", "/api/v1/health", None, origin=None)
        self.assertEqual(st, 403)
        self.assertEqual(json.loads(raw)["error"]["code"], "tls-required")
        # trusted proxy proto passes the gate (spoofed Host still never routes)
        st, _, _ = h2.api("GET", "/api/v1/health", None, origin=None,
                           headers={"X-Forwarded-Proto": "https"})
        self.assertEqual(st, 200)
        conn = http.client.HTTPConnection("127.0.0.1", h2.port, timeout=10)
        conn.putrequest("GET", "/api/v1/health", skip_host=True)
        conn.putheader("Host", "evil.example")
        conn.putheader("X-Forwarded-Proto", "https")
        conn.putheader("X-Forwarded-Host", "evil.example")
        conn.endheaders()
        resp = conn.getresponse()
        raw = resp.read()
        conn.close()
        self.assertIn(resp.status, (400, 404))
        self.assertEqual(json.loads(raw)["error"]["code"], "bad-host")

    # -- F4 publishing ownership -------------------------------------------
    def _upload_complete_session(self):
        data = b"f4-session"
        files = [{"path": "f.bin", "kind": "file", "size": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}]
        body = json.dumps({"name": "n", "kind": "file",
                           "visibility": "internal",
                           "files": files}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts:init",
                                    self.tok1, body=body,
                                    ctype="application/json")
        aid = json.loads(raw)["artifact_id"]
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        self.http.api("PUT", qp, self.tok1, body=data,
                      ctype="application/octet-stream",
                      headers={"X-Chunk-Sha256":
                               hashlib.sha256(data).hexdigest()})
        return aid, data

    def test_f4_publishing_staging_window_owner_only(self):
        aid, data = self._upload_complete_session()
        self.server._store._set_state_for_test(aid, "publishing")
        body = json.dumps({}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.tok2, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 403)
        self.assertEqual(json.loads(raw)["error"]["code"],
                         "session-not-owned")
        # non-owner recovery attempt preserved the state
        st, _, raw = self.http.api("GET", "/api/v1/artifacts/%s" % aid,
                                   self.tok1, origin=None)
        self.assertEqual(json.loads(raw)["state"], "publishing")
        # F4: non-owner chunk PUT against publishing is 403 (ownership
        # precedes state rejection) with no recovery effects.
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        st, _, raw = self.http.api(
            "PUT", qp, self.tok2, body=data,
            ctype="application/octet-stream",
            headers={"X-Chunk-Sha256":
                     hashlib.sha256(data).hexdigest()})
        self.assertEqual(st, 403)
        self.assertEqual(json.loads(raw)["error"]["code"],
                         "session-not-owned")
        st, _, raw = self.http.api("GET", "/api/v1/artifacts/%s" % aid,
                                   self.tok1, origin=None)
        self.assertEqual(json.loads(raw)["state"], "publishing")
        # F4: owner PUT against publishing is 409 (state, after ownership).
        st, _, raw = self.http.api(
            "PUT", qp, self.tok1, body=data,
            ctype="application/octet-stream",
            headers={"X-Chunk-Sha256":
                     hashlib.sha256(data).hexdigest()})
        self.assertEqual(st, 409)
        self.assertEqual(json.loads(raw)["error"]["code"],
                         "state-conflict")
        # F4: owner encountering publishing is 409 even though authorized
        # recovery prepares the retry (staging-complete -> ready on disk).
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 409)
        self.assertEqual(json.loads(raw)["error"]["code"],
                         "state-conflict")
        # subsequent owner retry observes the prepared ready state.
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 200, raw[:200])
        st, _, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % aid,
            self.tok1, origin=None)
        self.assertEqual(got, data)

    def test_f4_stuck_publishing_keeps_409(self):
        # Recovery attempted but still failing (persistent fsync fault):
        # the frozen 409 survives and the state is preserved for retry.
        from unittest import mock
        aid, _ = self._upload_complete_session()
        self.server._store._set_state_for_test(aid, "publishing")
        self.server._store._simulate_rename_for_test(aid)
        body = json.dumps({}).encode()
        with mock.patch("os.fsync", side_effect=OSError("disk fault")):
            st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                       self.tok1, body=body,
                                       ctype="application/json")
            self.assertEqual(st, 409)
            self.assertEqual(json.loads(raw)["error"]["code"],
                             "state-conflict")
        st, _, raw = self.http.api("GET", "/api/v1/artifacts/%s" % aid,
                                   self.tok1, origin=None)
        self.assertEqual(json.loads(raw)["state"], "publishing")
        # F4: fault cleared, owner encountering publishing is still 409
        # (recovery commits ready on disk to prepare the retry).
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 409)
        self.assertEqual(json.loads(raw)["error"]["code"],
                         "state-conflict")
        # subsequent owner retry observes ready.
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 200, raw[:300])

    def test_f4_publishing_live_window_owner_only(self):
        aid, data = self._upload_complete_session()
        self.server._store._set_state_for_test(aid, "publishing")
        self.server._store._simulate_rename_for_test(aid)
        body = json.dumps({}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.tok2, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 403)
        self.assertEqual(json.loads(raw)["error"]["code"],
                         "session-not-owned")
        st, _, raw = self.http.api("GET", "/api/v1/artifacts/%s" % aid,
                                   self.tok1, origin=None)
        self.assertEqual(json.loads(raw)["state"], "publishing")
        # F4: non-owner PUT in the live window is 403 without effects.
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        st, _, raw = self.http.api(
            "PUT", qp, self.tok2, body=data,
            ctype="application/octet-stream",
            headers={"X-Chunk-Sha256":
                     hashlib.sha256(data).hexdigest()})
        self.assertEqual(st, 403)
        self.assertEqual(json.loads(raw)["error"]["code"],
                         "session-not-owned")
        st, _, raw = self.http.api("GET", "/api/v1/artifacts/%s" % aid,
                                   self.tok1, origin=None)
        self.assertEqual(json.loads(raw)["state"], "publishing")
        # F4: owner encountering publishing is 409 (prepares retry).
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 409)
        self.assertEqual(json.loads(raw)["error"]["code"],
                         "state-conflict")
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 200, raw[:300])
        st, _, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % aid,
            self.tok1, origin=None)
        self.assertEqual(got, data)

    def test_f4_publishing_missing_tree_returns_to_uploading(self):
        # Neither tree complete: owner 409 prepares an uploading retry;
        # chunks resume and a subsequent publish completes.
        import shutil as _shutil
        aid, data = self._upload_complete_session()
        self.server._store._set_state_for_test(aid, "publishing")
        _shutil.rmtree(os.path.join(self.server._store.data_dir,
                                    "staging", aid), ignore_errors=True)
        body = json.dumps({}).encode()
        # non-owner sees 403 without recovery effects.
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.tok2, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 403)
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        st, _, raw = self.http.api(
            "PUT", qp, self.tok2, body=data,
            ctype="application/octet-stream",
            headers={"X-Chunk-Sha256":
                     hashlib.sha256(data).hexdigest()})
        self.assertEqual(st, 403)
        # owner 409 reverts to uploading with rebuilt topology.
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 409)
        self.assertEqual(json.loads(raw)["error"]["code"],
                         "state-conflict")
        st, _, raw = self.http.api("GET", "/api/v1/artifacts/%s" % aid,
                                   self.tok1, origin=None)
        self.assertEqual(json.loads(raw)["state"], "uploading")
        # resume the lost bytes, then publish completes.
        st, _, raw = self.http.api(
            "PUT", qp, self.tok1, body=data,
            ctype="application/octet-stream",
            headers={"X-Chunk-Sha256":
                     hashlib.sha256(data).hexdigest()})
        self.assertEqual(st, 200, raw[:200])
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 200, raw[:300])
        st, _, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % aid,
            self.tok1, origin=None)
        self.assertEqual(got, data)

    # -- R3 credential-bound grants --------------------------------------
    def _restart_with_users(self, users):
        self.server.close()
        self.server = create_server(_make_config(self.tmp.name, users))
        self.http = _Http(self.server.bound_port,
                          self.server.effective_api_origin)

    def test_r3_token_removal_kills_grants_and_handoffs(self):
        aid = _init(self.http, self.tok1, visibility="internal")
        cookie = _handoff_cookie(self.http, aid, self.tok1)
        body = json.dumps({}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts/%s/grants" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        outstanding = json.loads(raw)["grant"]
        # drop u1's token, keep the user shell with u2 only, restart
        self._restart_with_users([self.users[1]])
        st, _, _ = self.http.content(aid, "GET", "/f.bin",
                                     headers={"Cookie": cookie})
        self.assertEqual(st, 401)
        gbody = urllib.parse.urlencode({"grant": outstanding}).encode()
        st, _, raw = self.http.content(
            aid, "POST", "/__manure/grant", body=gbody,
            ctype="application/x-www-form-urlencoded",
            headers={"Origin": self.http.api_origin})
        self.assertEqual(st, 403)

    def test_r3_credential_replacement_same_labels_kills_grants(self):
        aid = _init(self.http, self.tok1, visibility="internal")
        cookie = _handoff_cookie(self.http, aid, self.tok1)
        # same user/token labels, fresh secret material
        u1b, tok1b = _mint(self.tmp.name, "u1", "t1")
        self._restart_with_users([u1b, self.users[1]])
        st, _, _ = self.http.content(aid, "GET", "/f.bin",
                                     headers={"Cookie": cookie})
        self.assertEqual(st, 401)
        # the new credential works end to end
        st, _, _ = self.http.api("GET", "/api/v1/whoami", tok1b,
                                 origin=None)
        self.assertEqual(st, 200)
        cookie2 = _handoff_cookie(self.http, aid, tok1b)
        st, _, got = self.http.content(aid, "GET", "/f.bin",
                                       headers={"Cookie": cookie2})
        self.assertEqual(st, 200)
        self.assertEqual(got, b"sec-data")

    def test_r3_logout_revokes_server_side_grants(self):
        aid = _init(self.http, self.tok1, visibility="internal")
        cookie = _handoff_cookie(self.http, aid, self.tok1)
        origin = "http://%s.artifacts.localhost:%d" % (aid, self.http.port)
        # content logout kills exactly the presented grant (replay dead)
        body = json.dumps({}).encode()
        st, _, _ = self.http.content(
            aid, "POST", "/__manure/logout", body=body,
            ctype="application/json",
            headers={"Origin": origin, "Cookie": cookie})
        self.assertEqual(st, 200)
        st, _, raw = self.http.content(aid, "GET", "/f.bin",
                                       headers={"Cookie": cookie})
        self.assertEqual(st, 401)
        self.assertEqual(json.loads(raw)["error"]["code"], "grant-required")
        # dashboard logout revokes the credential's remaining grants
        cookie2 = _handoff_cookie(self.http, aid, self.tok1)
        body = json.dumps({}).encode()
        st, _, _ = self.http.api("POST", "/api/v1/logout", self.tok1,
                                  body=body, ctype="application/json")
        self.assertEqual(st, 200)
        st, _, _ = self.http.content(aid, "GET", "/f.bin",
                                     headers={"Cookie": cookie2})
        self.assertEqual(st, 401)
        # bearer token itself still authenticates (only grants revoked)
        st, _, _ = self.http.api("GET", "/api/v1/whoami", self.tok1,
                                 origin=None)
        self.assertEqual(st, 200)

    # -- R2 header-safe filenames ----------------------------------------
    def test_r2_crlf_filename_rejected_at_init(self):
        bad_sha = hashlib.sha256(b"x").hexdigest()
        for bad in ("f\r\nX-Injected: yes", "a\tb", "lead\x7f"):
            files = [{"path": bad, "kind": "file", "size": 1,
                      "sha256": bad_sha}]
            body = json.dumps({"name": "n", "kind": "dir",
                               "visibility": "internal",
                               "files": files}).encode()
            st, _, raw = self.http.api("POST", "/api/v1/artifacts:init",
                                        self.tok1, body=body,
                                        ctype="application/json")
            self.assertEqual(st, 400, bad)
            self.assertEqual(json.loads(raw)["error"]["code"],
                             "invalid-path")

    def test_r2_unicode_and_special_filenames(self):
        names = ["h\u00e9llo-\U0001F600.txt", "a%20b.txt", "q?u#e.txt"]
        blobs = {name: ("bytes-" + name).encode("utf-8") for name in names}
        files = [{"path": name, "kind": "file",
                  "size": len(blobs[name]),
                  "sha256": hashlib.sha256(blobs[name]).hexdigest()}
                 for name in names]
        body = json.dumps({"name": "n", "kind": "dir",
                           "visibility": "public", "files": files}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts:init",
                                    self.tok1, body=body,
                                    ctype="application/json")
        self.assertEqual(st, 200, raw[:300])
        aid = json.loads(raw)["artifact_id"]
        for name, blob in blobs.items():
            qp = "/api/v1/artifacts/%s/chunks?path=%s&offset=0" % (
                aid, urllib.parse.quote(name, safe=""))
            st, _, raw = self.http.api(
                "PUT", qp, self.tok1, body=blob,
                ctype="application/octet-stream",
                headers={"X-Chunk-Sha256": hashlib.sha256(blob).hexdigest()})
            self.assertEqual(st, 200, (name, raw[:200]))
        body = json.dumps({}).encode()
        self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                      self.tok1, body=body, ctype="application/json")
        for name, blob in blobs.items():
            enc = "/".join(urllib.parse.quote(seg, safe="")
                             for seg in name.split("/"))
            st, hdrs, got = self.http.api(
                "GET", "/api/v1/artifacts/%s/files/%s/content" % (aid, enc),
                None, origin=None)
            self.assertEqual(st, 200, name)
            self.assertEqual(got, blob)
            disp = hdrs.get("Content-Disposition", "")
            self.assertTrue(disp.startswith("attachment; "), disp)
            self.assertIn("filename*=UTF-8''", disp)
            self.assertNotIn("\r", disp)
            self.assertNotIn("\n", disp)
            self.assertEqual(hdrs.get("Accept-Ranges"), "bytes")
            self.assertEqual(hdrs.get("X-Content-Type-Options"), "nosniff")

    def test_r2_dir_redirect_encoding(self):
        idx = b"<html>i</html>"
        files = [
            {"path": "we?ird", "kind": "dir"},
            {"path": "we?ird/index.html", "kind": "file",
             "size": len(idx), "sha256": hashlib.sha256(idx).hexdigest()},
            {"path": "100%", "kind": "dir"},
            {"path": "100%/index.html", "kind": "file",
             "size": len(idx), "sha256": hashlib.sha256(idx).hexdigest()},
        ]
        body = json.dumps({"name": "n", "kind": "dir",
                           "visibility": "public", "files": files}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts:init",
                                    self.tok1, body=body,
                                    ctype="application/json")
        self.assertEqual(st, 200, raw[:300])
        aid = json.loads(raw)["artifact_id"]
        for name in ("we?ird/index.html", "100%/index.html"):
            qp = "/api/v1/artifacts/%s/chunks?path=%s&offset=0" % (
                aid, urllib.parse.quote(name, safe=""))
            self.http.api("PUT", qp, self.tok1, body=idx,
                          ctype="application/octet-stream",
                          headers={"X-Chunk-Sha256":
                                   hashlib.sha256(idx).hexdigest()})
        body = json.dumps({}).encode()
        self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                      self.tok1, body=body, ctype="application/json")
        st, hdrs, _ = self.http.content(aid, "GET", "/we%3Fird")
        self.assertEqual(st, 303)
        self.assertEqual(hdrs.get("Location"), "/we%3Fird/")
        st, hdrs, _ = self.http.content(aid, "GET", "/100%25")
        self.assertEqual(st, 303)
        self.assertEqual(hdrs.get("Location"), "/100%25/")

    # -- R13 unexpected/symlinked live bytes ------------------------------
    def test_r13_unexpected_live_files_never_served(self):
        aid = _init(self.http, self.tok1, visibility="public")
        live = os.path.join(self.tmp.name, "data", "live", aid)
        with open(os.path.join(live, "evil.txt"), "w") as fh:
            fh.write("planted")
        st, _, _ = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/evil.txt/content" % aid,
            None, origin=None)
        self.assertEqual(st, 404)
        st, _, _ = self.http.content(
            aid, "GET", "/__manure/files/evil.txt/content")
        self.assertEqual(st, 404)
        # the declared file still serves on both origins
        st, _, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % aid,
            None, origin=None)
        self.assertEqual(got, b"sec-data")

    def test_r13_symlinked_live_serves_nothing(self):
        aid = _init(self.http, self.tok1, visibility="public")
        live = os.path.join(self.tmp.name, "data", "live", aid)
        secret = os.path.join(self.tmp.name, "secret.txt")
        with open(secret, "w") as fh:
            fh.write("outside-bytes")
        target = os.path.join(live, "f.bin")
        os.remove(target)
        os.symlink(secret, target)
        st, _, got = self.http.api(
            "GET", "/api/v1/artifacts/%s/files/f.bin/content" % aid,
            None, origin=None)
        self.assertEqual(st, 404)
        self.assertNotIn(b"outside-bytes", got)
        st, _, got = self.http.content(aid, "GET", "/f.bin")
        self.assertEqual(st, 404)
        self.assertNotIn(b"outside-bytes", got)

    # -- R4 invalid PATCH preserves grants --------------------------------
    def test_r4_rejected_patch_leaves_grants_unchanged(self):
        aid = _init(self.http, self.tok1, visibility="internal")
        cookie = _handoff_cookie(self.http, aid, self.tok1)
        body = json.dumps({"visibility": "external",
                           "expires_in_s": 5}).encode()
        st, _, raw = self.http.api("PATCH", "/api/v1/artifacts/%s" % aid,
                                   self.tok1, body=body,
                                   ctype="application/json")
        self.assertEqual(st, 400)
        self.assertEqual(json.loads(raw)["error"]["code"], "invalid-ttl")
        # artifact and pre-existing grant both untouched
        st, _, raw = self.http.api("GET", "/api/v1/artifacts/%s" % aid,
                                   self.tok1, origin=None)
        self.assertEqual(json.loads(raw)["visibility"], "internal")
        st, _, got = self.http.content(aid, "GET", "/f.bin",
                                       headers={"Cookie": cookie})
        self.assertEqual(st, 200)
        self.assertEqual(got, b"sec-data")

    # -- R14 content headers + built-in form flow --------------------------
    def _content_origin_of(self, aid):
        return "http://%s.artifacts.localhost:%d" % (aid, self.http.port)

    def test_r14_content_error_and_control_headers(self):
        data = b"r14-external"
        files = [{"path": "f.bin", "kind": "file", "size": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}]
        body = json.dumps({"name": "n", "kind": "file",
                           "visibility": "external",
                           "files": files}).encode()
        st, _, raw = self.http.api("POST", "/api/v1/artifacts:init",
                                    self.tok1, body=body,
                                    ctype="application/json")
        aid = json.loads(raw)["artifact_id"]
        password = json.loads(raw)["external_password"]
        qp = "/api/v1/artifacts/%s/chunks?path=f.bin&offset=0" % aid
        self.http.api("PUT", qp, self.tok1, body=data,
                      ctype="application/octet-stream",
                      headers={"X-Chunk-Sha256":
                               hashlib.sha256(data).hexdigest()})
        body = json.dumps({}).encode()
        self.http.api("POST", "/api/v1/artifacts/%s/publish" % aid,
                      self.tok1, body=body, ctype="application/json")
        origin = self._content_origin_of(aid)
        # password page: no-store + content CSP
        st, hdrs, _ = self.http.content(aid, "GET", "/__manure/password")
        self.assertEqual(st, 200)
        self.assertEqual(hdrs.get("Cache-Control"), "no-store")
        self.assertIn("frame-ancestors 'none'",
                      hdrs.get("Content-Security-Policy", ""))
        # failed JSON unlock: 401 envelope + same policies
        bad = json.dumps({"password": "x" * 43}).encode()
        st, hdrs, raw = self.http.content(aid, "POST", "/__manure/unlock",
                                          body=bad, ctype="application/json",
                                          headers={"Origin": origin})
        self.assertEqual(st, 401)
        self.assertEqual(json.loads(raw)["error"]["code"], "password-invalid")
        self.assertEqual(hdrs.get("Cache-Control"), "no-store")
        self.assertIn("frame-ancestors 'none'",
                      hdrs.get("Content-Security-Policy", ""))
        # built-in form flow: urlencoded unlock -> 303 + grant cookie
        form = urllib.parse.urlencode({"password": password}).encode()
        st, hdrs, _ = self.http.content(
            aid, "POST", "/__manure/unlock", body=form,
            ctype="application/x-www-form-urlencoded",
            headers={"Origin": origin})
        self.assertEqual(st, 303)
        self.assertEqual(hdrs.get("Location"), "/")
        self.assertEqual(hdrs.get("Cache-Control"), "no-store")
        cookie = hdrs["Set-Cookie"].split(";", 1)[0]
        st, _, got = self.http.content(aid, "GET", "/f.bin",
                                       headers={"Cookie": cookie})
        self.assertEqual(st, 200)
        self.assertEqual(got, data)
        # unauthorized manifest: 401 + policies (never the password form)
        st, hdrs, raw = self.http.content(aid, "GET", "/__manure/manifest")
        self.assertEqual(st, 401)
        self.assertEqual(json.loads(raw)["error"]["code"], "grant-required")
        self.assertEqual(hdrs.get("Cache-Control"), "no-store")
        self.assertIn("frame-ancestors 'none'",
                      hdrs.get("Content-Security-Policy", ""))
        # unknown control route: 404 + policies
        st, hdrs, _ = self.http.content(aid, "GET", "/__manure/bogus")
        self.assertEqual(st, 404)
        self.assertEqual(hdrs.get("Cache-Control"), "no-store")
        self.assertIn("Origin-Agent-Cluster", hdrs)

    def test_security_headers_api_and_content(self):
        aid = _init(self.http, self.tok1)
        st, hdrs, _ = self.http.api("GET", "/api/v1/artifacts", self.tok1,
                                    origin=None)
        self.assertEqual(st, 200)
        for required in ("Origin-Agent-Cluster", "Cross-Origin-Opener-Policy",
                         "Cross-Origin-Resource-Policy",
                         "X-Content-Type-Options", "Referrer-Policy",
                         "Cache-Control"):
            self.assertIn(required, hdrs, required)
        self.assertNotIn("Access-Control-Allow-Origin", hdrs)
        cookie = _handoff_cookie(self.http, aid, self.tok1)
        st, hdrs, _ = self.http.content(aid, "GET", "/f.bin",
                                        headers={"Cookie": cookie})
        self.assertIn("Content-Security-Policy", hdrs)
        self.assertIn("frame-ancestors 'none'", hdrs["Content-Security-Policy"])
        self.assertIn("Origin-Agent-Cluster", hdrs)


if __name__ == "__main__":
    unittest.main()
