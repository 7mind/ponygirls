"""B4 / B5 / B6: content isolation, attachment downloads, reserved names.

Real Chromium + real manure server. Per-artifact origins must isolate
uploaded JS (SOP); management APIs must be absent from content hosts;
API byte downloads must be attachment (never execute under the API
origin); reserved __manure/api prefixes must never serve user content.
"""

from __future__ import annotations

import hashlib
import os
import sys
import unittest
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import browser_fixtures as bf

A_HTML = ("<!DOCTYPE html><html><head><meta charset=utf-8><title>A</title></head>"
          "<body><h1>artifact A</h1>"
          "<script>localStorage.setItem('a-secret','from-A');"
          "document.title='A:'+location.host</script>"
          "</body></html>").encode()
B_HTML = ("<!DOCTYPE html><html><head><meta charset=utf-8><title>B</title></head>"
          "<body><h1>artifact B</h1></body></html>").encode()
EVIL_HTML = b"<script>document.title='EXECUTED'</script><h1>evil</h1>"


class IsolationFlows:
    suffix_mode = "sibling"

    @classmethod
    def setUpClass(cls):
        cls.fix = bf.start_server(suffix_mode=cls.suffix_mode)
        cls.http = cls.fix.http
        cls.api = cls.fix.api_base
        cls.bearer = {"Authorization": f"Bearer {cls.fix.identity.token}"}

    @classmethod
    def tearDownClass(cls):
        cls.fix.close()

    def _make_dir(self, name, html, visibility="internal"):
        created = bf.upload_fixture(
            self.fix, name=name, kind="dir",
            visibility=visibility, files={"index.html": html})
        return created["artifact_id"], bf.content_url_for(self.fix, created["artifact_id"])

    def _internal_dir(self, name, html):
        return self._make_dir(name, html, "internal")

    def _grant_cookie_jar(self, aid):
        """Fetch a one-time grant and redeem it; returns a jar holding the
        grant cookie for the artifact's content host."""
        grant_res = self.http.request(
            "POST", f"{self.api}/api/v1/artifacts/{aid}/grants",
            body={}, headers=self.bearer)
        self.assertEqual(grant_res.status, 200, grant_res.body[:300])
        content_url = bf.content_url_for(self.fix, aid)
        jar = bf.TestHttp()
        origin = self.api
        redeem = jar.request(
            "POST", content_url.rstrip("/") + "/__manure/grant",
            body={"grant": grant_res.json()["grant"]},
            content_type="application/json", headers={"Origin": origin})
        self.assertEqual(redeem.status, 200, redeem.body[:300])
        return jar, content_url

    # -- B4 ----------------------------------------------------------

    def test_b4_artifacts_cannot_read_each_other(self):
        # SOP is visibility-independent (identical isolation headers either
        # way), so the browser leg uses public artifacts: no grant
        # machinery stands between the pages and the assertions. The
        # grant-gated internal path is exercised by B2.
        aid_a, url_a = self._make_dir("iso-A", A_HTML, "public")
        aid_b, url_b = self._make_dir("iso-B", B_HTML, "public")
        # Cross-artifact fetch from page JS is rejected (no CORS bypass:
        # the server must not emit Access-Control-Allow-Origin).
        probe = ("(u) => fetch(u).then(() => 'READABLE').catch((e) => 'BLOCKED:' + e.name)")
        out = bf.run_steps([
            {"op": "goto", "url": url_a},
            {"op": "waitForEval",
             "fn": "() => document.title.indexOf('A:') === 0"},
            {"op": "eval", "fn": probe, "arg": url_b},
            {"op": "eval", "fn": "() => localStorage.getItem('a-secret')"},
            {"op": "newPage", "url": url_b},
            {"op": "eval", "fn": "() => [document.title,"
                                 " (localStorage.getItem('a-secret') === null"
                                 " ? 'absent' : 'LEAKED')].join('|')"},
            {"op": "text", "selector": "body"},
        ])
        results = [r for r in out
                   if r.get("op") not in ("pageerrors", "dialogs",
                                           "requests", "console")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        # op "eval" results in step order: probe, A-storage, B-perspective.
        # (waitForEval reports under its own op name.)
        evals = [r for r in out if r.get("op") == "eval"]
        self.assertTrue(evals[0]["value"].startswith("BLOCKED"), evals[0])
        # A-planted storage is readable on A itself (sanity) ...
        self.assertEqual(evals[1]["value"], "from-A", evals[1])
        # ... but invisible from B's origin (separate origins), while B's
        # own bytes render (public, no grant needed).
        self.assertEqual(evals[2]["value"], "B|absent", evals[2])
        bodies = [r for r in out if r.get("op") == "text"]
        self.assertTrue(bodies and bodies[0].get("ok"), out)
        self.assertIn("artifact B", bodies[0]["text"] or "", bodies[0])
        # ... and no ACAO header exists to punch through SOP.
        anon = bf.TestHttp()
        res = anon.request("GET", url_a)
        self.assertEqual(res.status, 200, res.body[:200])
        self.assertIsNone(res.header("Access-Control-Allow-Origin"), res.headers)

    def test_b4_content_responses_carry_isolation_headers(self):
        aid, url = self._internal_dir("iso-headers", B_HTML)
        jar, _ = self._grant_cookie_jar(aid)
        res = jar.request("GET", url)
        self.assertEqual(res.status, 200, res.body[:300])
        ctype = res.header("Content-Type") or ""
        self.assertIn("text/html", ctype, res.headers)
        csp = res.header("Content-Security-Policy") or ""
        self.assertIn("frame-ancestors 'none'", csp, res.headers)
        self.assertIn("base-uri 'none'", csp, res.headers)
        self.assertIn("form-action 'self'", csp, res.headers)
        self.assertNotIn("sandbox", csp, res.headers)
        self.assertEqual(res.header("X-Content-Type-Options"), "nosniff")
        self.assertEqual(res.header("Referrer-Policy"), "no-referrer")
        self.assertEqual(
            res.header("Cross-Origin-Resource-Policy"), "same-origin")
        self.assertEqual(
            res.header("Cross-Origin-Opener-Policy"), "same-origin")
        self.assertEqual(res.header("Origin-Agent-Cluster"), "?1")
        self.assertIsNone(res.header("Access-Control-Allow-Origin"))
        # Cookies set anywhere by manure carry no Domain attribute.
        for line in (res.headers.get_all("Set-Cookie", []) or []):
            self.assertNotIn("domain=", line.lower(), line)

    def test_b4_management_paths_absent_from_content_origin(self):
        aid, url = self._internal_dir("iso-mgmt", B_HTML)
        jar, _ = self._grant_cookie_jar(aid)
        for path in ("/api/v1/health", "/api/v1/artifacts",
                     "/__manure/nope", "/api/"):
            res = jar.request("GET", url.rstrip("/") + path)
            self.assertEqual(res.status, 404, (path, res.status, res.body[:200]))
            self.assertEqual(res.json()["error"]["code"], "not-found",
                             (path, res.body[:200]))
        # Same over a real browser navigation (status observed by the step).
        out = bf.run_steps([
            {"op": "goto", "url": url.rstrip("/") + "/api/v1/health"},
        ])
        self.assertEqual(out[0]["status"], 404, out)

    def test_b4_framing_blocked_by_header(self):
        aid, url = self._internal_dir("iso-frame", B_HTML)
        jar, _ = self._grant_cookie_jar(aid)
        res = jar.request("GET", url)
        csp = res.header("Content-Security-Policy") or ""
        self.assertIn("frame-ancestors 'none'", csp, res.headers)
        # Browser leg: frame a PUBLIC artifact from an uploaded parent that
        # permits frames. The child announces itself with a postMessage
        # nonce, which crosses origins freely -- so a missing nonce proves
        # the frame never loaded (frame-ancestors), not an SOP read
        # failure (SOP would still let the child run and announce).
        # A data: control child proves the channel itself works.
        child = (b"<!DOCTYPE html><html><head><meta charset=utf-8>"
                 b"<title>NONCE-CHILD</title></head><body>"
                 b"<script>if (window !== window.parent) {"
                 b" window.addEventListener('load', function () {"
                 b" parent.postMessage('B-NONCE', '*'); }); }</script>"
                 b"</body></html>")
        created_b = bf.upload_fixture(
            self.fix, name="iso-framed", kind="dir",
            visibility="public", files={"index.html": child})
        url_b = bf.content_url_for(self.fix, created_b["artifact_id"])
        parent = ("<!DOCTYPE html><html><head><meta charset=utf-8>"
                  "<title>FRAME-PARENT</title></head><body>"
                  "<script>"
                  "window.__got = {data: false, b: false};"
                  "window.addEventListener('message', function (e) {"
                  "  if (e.data === 'DATA-OK') { window.__got.data = true; }"
                  "  if (e.data === 'B-NONCE') { window.__got.b = true; }"
                  "});"
                  "window.addEventListener('load', function () {"
                  "  var d = document.createElement('iframe');"
                  "  d.src = \"data:text/html,<script>parent.postMessage('DATA-OK','*')</\" + \"script>\";"
                  "  document.body.appendChild(d);"
                  "  var t = document.createElement('iframe');"
                  "  t.src = '" + url_b + "';"
                  "  document.body.appendChild(t);"
                  "});"
                  "</script></body></html>").encode()
        created_a = bf.upload_fixture(
            self.fix, name="iso-framer", kind="dir",
            visibility="public", files={"index.html": parent})
        url_a = bf.content_url_for(self.fix, created_a["artifact_id"])
        out = bf.run_steps([
            {"op": "goto", "url": url_a},
            {"op": "eval",
             "fn": "() => new Promise((res) => setTimeout("
                   "() => res(JSON.stringify(window.__got)), 3500))"},
            # The child loads standalone: auth failure cannot explain a
            # missing nonce above.
            {"op": "goto", "url": url_b},
            {"op": "text", "selector": "title"},
        ])
        results = [r for r in out
                   if r.get("op") not in ("pageerrors", "dialogs",
                                           "requests", "console")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        import json as _json
        verdict = _json.loads([r for r in out if r.get("op") == "eval"][0]["value"])
        self.assertTrue(verdict["data"],
                        "control data: frame never announced (channel broken?)")
        self.assertFalse(verdict["b"],
                         "artifact page framed despite frame-ancestors 'none'")
        titles = [r for r in out if r.get("op") == "text"]
        self.assertIn("NONCE-CHILD", titles[0]["text"] or "")

    # -- B5 ------------------------------------------------------------

    def test_b5_api_bytes_are_attachment_and_never_execute(self):
        created = bf.upload_fixture(
            self.fix, name="attach-probe", kind="file",
            visibility="internal", files={"evil.html": EVIL_HTML})
        aid = created["artifact_id"]
        api_content = (f"{self.api}/api/v1/artifacts/{aid}/files/"
                       + urllib.parse.quote("evil.html", safe="") + "/content")
        res = self.http.request("GET", api_content, headers=self.bearer)
        self.assertEqual(res.status, 200, res.body[:300])
        disp = res.header("Content-Disposition") or ""
        self.assertIn("attachment", disp, res.headers)
        self.assertEqual(res.header("X-Content-Type-Options"), "nosniff")
        self.assertEqual(res.header("Content-Type"), "application/octet-stream")
        self.assertEqual(res.header("Cross-Origin-Resource-Policy"), "same-origin")
        self.assertEqual(res.body, EVIL_HTML)
        # Browser: navigating a logged-in session at the API byte URL
        # must download the bytes instead of executing them under the API
        # origin. Arm the download waiter BEFORE location.assign in ONE helper
        # operation (assignDownload, as with click-driven downloads): a separate
        # waiter step after navigation races a fast download. Verify the exact
        # bytes, then assert the dashboard URL/title are exactly unchanged and
        # the execution sentinel never ran.
        token = self.fix.identity.token
        out = bf.run_steps([
            {"op": "goto", "url": self.api + "/"},
            {"op": "fill", "selector": "#token-input", "value": token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "shown"},
            {"op": "eval", "fn": "() => JSON.stringify("
                                 "{href: location.href, title: document.title})"},
            {"op": "assignDownload", "url": api_content, "timeoutMs": 20000},
            {"op": "eval", "fn": "() => JSON.stringify("
                                 "{href: location.href, title: document.title})"},
        ])
        results = [r for r in out
                   if r.get("op") not in ("pageerrors", "dialogs",
                                           "requests", "console")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        import json as _json
        dl = [r for r in out if r.get("op") == "assignDownload"][0]
        with open(dl["path"], "rb") as fh:
            self.assertEqual(fh.read(), EVIL_HTML, "downloaded bytes differ")
        states = [r for r in out if r.get("op") == "eval"]
        before = _json.loads(states[0]["value"])
        after = _json.loads(states[1]["value"])
        self.assertEqual(after["href"], before["href"],
                         "byte URL navigated instead of downloading")
        self.assertEqual(after["title"], before["title"])
        self.assertNotEqual(after["title"], "EXECUTED")

    # -- B6 --------------------------------------------------------------

    def test_b6_reserved_prefixes_never_serve_user_content(self):
        for bad_path in ("__manure/x.txt", "api/y.txt",
                         "__manure", "api"):
            res = self.http.request(
                "POST", self.api + "/api/v1/artifacts:init",
                body={"name": "reserved", "kind": "file", "visibility": "internal",
                      "files": [{"path": bad_path, "kind": "file",
                                 "size": 1, "sha256": hashlib.sha256(b"x").hexdigest()}]},
                headers=self.bearer)
            self.assertEqual(res.status, 400, (bad_path, res.status, res.body[:200]))
            self.assertEqual(res.json()["error"]["code"], "invalid-path",
                             (bad_path, res.body[:200]))
        # Control endpoints keep their meaning on content hosts: the
        # password helper is 404 for internal artifacts.
        aid, url = self._internal_dir("iso-reserved", B_HTML)
        jar, _ = self._grant_cookie_jar(aid)
        pw = jar.request("GET", url.rstrip("/") + "/__manure/password")
        self.assertEqual(pw.status, 404, pw.body[:200])


class IsolationSiblingCase(IsolationFlows, unittest.TestCase):
    suffix_mode = "sibling"


class IsolationSeparateCase(IsolationFlows, unittest.TestCase):
    suffix_mode = "separate"


if __name__ == "__main__":
    unittest.main()
