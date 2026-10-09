"""Production-boundary TLS smoke: real TLS edge, Secure + __Host cookies.

Real manure server behind a sandbox-local TLS-terminating edge
(stdlib proxy in browser_fixtures: Host preserved, single exact
X-Forwarded-Proto: https), driving real Chromium with certificate
errors ignored (ephemeral self-signed cert, sandbox-local only).

Covers what the loopback suite cannot: Secure attributes, __Host-
(not -dev) names, tls-required without the edge, and the dashboard
handoff across a SEPARATE registrable content domain over HTTPS.
"""

from __future__ import annotations

import json
import os
import sys
import unittest
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import browser_fixtures as bf

INDEX_HTML = ("<!DOCTYPE html><html><head><meta charset=utf-8>"
              "<title>TLS-HANDOFF-PLACEHOLDER</title></head>"
              "<body><h1>tls site</h1>"
              "<script>document.title='TLS-OK:'+location.host</script>"
              "</body></html>")
EXT_HTML = b"<!DOCTYPE html><html><body><h1>tls external site</h1></body></html>"


class TlsSmokeCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fix = bf.start_https_server()
        cls.http = cls.fix.http
        cls.api = cls.fix.api_base
        assert cls.api.startswith("https://"), cls.api

    @classmethod
    def tearDownClass(cls):
        cls.fix.close()

    def _browser(self, steps):
        return bf.run_steps(
            steps, ignore_https_errors=True,
            host_resolver_rules=bf.TLS_RESOLVER_RULES)

    def _login_steps(self, token):
        return [
            {"op": "goto", "url": self.api + "/"},
            {"op": "fill", "selector": "#token-input", "value": token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#whoami-text",
             "contains": self.fix.identity.user_id},
        ]

    def test_tls_edge_required_without_proxy(self):
        # Direct plain-HTTP to the backend (no trusted X-Forwarded-Proto)
        # is rejected even with a valid Host: the edge owns TLS.
        port = urllib.parse.urlsplit(self.api).port
        direct = bf.TestHttp().request(
            "GET", f"http://127.0.0.2:{port}/api/v1/health",
            headers={"Host": bf.TLS_API_HOST})
        self.assertEqual(direct.status, 403, direct.body[:300])
        self.assertEqual(direct.json()["error"]["code"], "tls-required")
        # Through the edge the same Host routes to the dashboard.
        import ssl as _ssl
        import socket as _socket
        raw = _socket.create_connection(("127.0.0.1", port), timeout=30)
        ctx = _ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = _ssl.CERT_NONE
        tls = ctx.wrap_socket(raw, server_hostname=bf.TLS_API_HOST)
        try:
            tls.sendall(f"GET / HTTP/1.1\r\nHost: {bf.TLS_API_HOST}\r\n"
                        f"Connection: close\r\n\r\n".encode())
            chunks = []
            while True:
                data = tls.recv(65536)
                if not data:
                    break
                chunks.append(data)
        finally:
            tls.close()
        head = b"".join(chunks).split(b"\r\n\r\n", 1)[0].decode("latin-1")
        self.assertIn("200", head.split("\r\n", 1)[0], head[:300])

    def test_tls_login_sets_secure_host_cookies(self):
        token = self.fix.identity.token
        out = self._browser(self._login_steps(token) + [
            {"op": "eval", "fn": "(s) => document.querySelector(s).value",
             "arg": "#token-input"},
            {"op": "localStorageKeys"},
            {"op": "cookies", "urls": [self.api + "/"]},
        ])
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs",
                                                         "requests", "console")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        by_op = {}
        for r in out:
            by_op.setdefault(r["op"], []).append(r)
        self.assertEqual(by_op["eval"][0]["value"], "")
        self.assertEqual(by_op["localStorageKeys"][0]["keys"], [])
        cookies = by_op["cookies"][0]["cookies"]
        session = [c for c in cookies if c["name"] == "__Host-manure"]
        self.assertEqual(len(session), 1, cookies)
        sess = session[0]
        self.assertTrue(sess["secure"], sess)
        self.assertTrue(sess["httpOnly"], sess)
        self.assertEqual(sess["path"], "/")
        self.assertEqual((sess["sameSite"] or "").lower(), "strict")
        self.assertEqual(sess["domain"], bf.TLS_API_HOST, sess)

    def test_tls_handoff_across_separate_domains(self):
        created = bf.upload_fixture(
            self.fix, name="tls-handoff", kind="dir",
            visibility="internal", files={"index.html": INDEX_HTML.encode()})
        aid = created["artifact_id"]
        content_url = self.fix.server.content_url(aid)
        origin = "{0.scheme}://{0.netloc}".format(
            urllib.parse.urlsplit(content_url))
        self.assertIn(bf.TLS_CONTENT_SUFFIX,
                      urllib.parse.urlsplit(content_url).hostname or "")
        token = self.fix.identity.token
        out = self._browser(self._login_steps(token) + [
            {"op": "waitForText", "selector": "#list-status",
             "contains": "shown"},
            {"op": "click",
             "selector": "button[data-action=open][data-artifact-id=\"" + aid + "\"]"},
            {"op": "waitForEval",
             "fn": "() => document.title.indexOf('TLS-OK:') === 0"},
            {"op": "eval", "fn": "() => document.cookie"},
            {"op": "eval", "fn": "() => location.href"},
            {"op": "cookies", "urls": [origin, self.api + "/"]},
        ])
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs",
                                                         "requests", "console")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        evals = [r for r in out if r.get("op") == "eval"]
        self.assertIn(aid, evals[1]["value"])
        self.assertNotIn("grant", evals[1]["value"])
        self.assertNotIn(token, evals[1]["value"])
        bf.assert_no_secrets_in_request_urls(self, out, [token])
        cookies = [r for r in out if r.get("op") == "cookies"][0]["cookies"]
        by_url = {}
        for c in cookies:
            by_url.setdefault(c["url"], []).append(c)
        grants = [c for c in by_url.get(origin, [])
                  if c["name"] == "__Host-mgrant"]
        self.assertEqual(len(grants), 1, cookies)
        self.assertTrue(grants[0]["secure"], grants[0])
        self.assertTrue(grants[0]["httpOnly"], grants[0])
        self.assertEqual((grants[0]["sameSite"] or "").lower(), "lax")
        content_names = {c["name"] for c in by_url.get(origin, [])}
        self.assertNotIn("__Host-manure", content_names)

    def test_tls_external_unlock_round_trip(self):
        created = bf.upload_fixture(
            self.fix, name="tls-ext", kind="dir",
            visibility="external", files={"index.html": EXT_HTML})
        password = created["external_password"]
        self.assertTrue(password)
        content_url = self.fix.server.content_url(created["artifact_id"])
        out = self._browser([
            {"op": "goto", "url": content_url},
            {"op": "fill", "selector": "#password-input", "value": password},
            {"op": "click", "selector": "#unlock-form button[type=submit]"},
            {"op": "waitForText", "selector": "h1",
             "contains": "tls external site"},
            {"op": "eval", "fn": "() => location.href"},
        ])
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs",
                                                         "requests", "console")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        href = [r for r in out if r.get("op") == "eval"][0]["value"]
        self.assertNotIn(password, href)
        bf.assert_no_secrets_in_request_urls(self, out, [password])

    def test_tls_hostile_planted_none_secure_cannot_mutate(self):
        """R1 separate-domain proof: TESTONLY None/Secure planting.

        Over real TLS the runtime Strict __Host-manure is withheld cross-site
        (401, correctly reported as [] via blockedReasons, never 403 proof).
        Planting a TESTONLY None/Secure copy of the VALID victim cookie forces
        dispatch without changing runtime defaults; the hostile SIMPLE POSTs
        (urlencoded, no preflight) then carry the cookie with the wrong Origin
        and the server must answer 403 with TARGETED state unchanged. Clean
        valid-login from the hostile origin is 403 with NO session in both.
        Captures complete headers + statuses redacted; retains HTTP complements.
        """
        token = self.fix.identity.token
        bearer = {"Authorization": f"Bearer {token}"}
        victim = bf.upload_fixture(
            self.fix, name="tls-csrf-victim", kind="file",
            visibility="internal", files={"note.txt": b"tls victim bytes"})
        vid = victim["artifact_id"]
        hostile_html = (
            "<!DOCTYPE html><html><head><meta charset=utf-8><title>HOSTILE</title></head>"
            "<body><h1>hostile</h1><script>"
            "window.__atk = {};"
            "async function attempt(name, url, opts) {"
            "  try { const r = await fetch(url, opts);"
            "    window.__atk[name] = 'READABLE:' + r.status; }"
            "  catch (e) { window.__atk[name] = 'BLOCKED:' + e.name; }"
            "}"
            "async function run() {"
            "  const base = '" + self.api + "';"
            "  const vid = '" + vid + "';"
            "  await attempt('read', base + '/api/v1/artifacts',"
            "    {credentials:'include'});"
            "  await attempt('grants', base + '/api/v1/artifacts/' + vid + '/grants',"
            "    {method:'POST', credentials:'include',"
            "     headers:{'Content-Type':'application/x-www-form-urlencoded'},"
            "     body:'x=1'});"
            "  await attempt('logout', base + '/api/v1/logout',"
            "    {method:'POST', credentials:'include',"
            "     headers:{'Content-Type':'application/x-www-form-urlencoded'},"
            "     body:'x=1'});"
            "  await attempt('login', base + '/api/v1/login',"
            "    {method:'POST', credentials:'include',"
            "     headers:{'Content-Type':'application/x-www-form-urlencoded'},"
            "     body:'token=" + token + "'});"
            "  window.__atk.cookie = document.cookie;"
            "  window.__atk.storage = Object.keys(window.localStorage).length"
            "    + ',' + Object.keys(window.sessionStorage).length;"
            "  document.title = 'ATK:' + JSON.stringify(window.__atk);"
            "}"
            "window.addEventListener('load', run);"
            "</scr" + "ipt></body></html>").encode()
        hostile = bf.upload_fixture(
            self.fix, name="tls-hostile", kind="dir",
            visibility="public", files={"index.html": hostile_html})
        hurl = self.fix.server.content_url(hostile["artifact_id"])
        hostile_origin = "{0.scheme}://{0.netloc}".format(
            urllib.parse.urlsplit(hurl))
        SESSION = "__Host-manure"

        def _reqs(out, suffix):
            return [q for q in bf.requests_log(out)
                    if q["url"].endswith(suffix)]

        def _resps(out, suffix):
            return [r for r in bf.responses_log(out)
                    if r["url"].endswith(suffix)]

        # -- CLEAN: valid login from hostile origin, 403, no session.
        out_clean = self._browser([
            {"op": "goto", "url": hurl},
            {"op": "waitForEval",
             "fn": "() => document.title.indexOf('ATK:') === 0"},
            {"op": "waitForEval",
             "fn": "() => new Promise((res) => setTimeout(() => res(true), 1000))"},
            {"op": "eval", "fn": "() => document.title"},
            {"op": "cookies", "urls": [self.api + "/", hurl]},
        ])
        results = [r for r in out_clean if r.get("op") not in ("pageerrors", "dialogs",
                                                                 "requests", "responses", "console")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        atk = json.loads([r for r in out_clean if r.get("op") == "eval"][-1]["value"][4:])
        self.assertTrue(atk["login"].startswith("BLOCKED"), atk)
        self.assertEqual(atk["cookie"], "", atk)
        bf.assert_no_secrets_in_request_urls(self, out_clean, [token])
        login_reqs = [q for q in _reqs(out_clean, "/api/v1/login")
                      if q["method"] == "POST" and q["origin"] == hostile_origin]
        self.assertTrue(login_reqs, bf.requests_log(out_clean))
        self.assertEqual(login_reqs[0]["cookieNames"], [], login_reqs[0])
        self.assertTrue(any(r["status"] == 403 for r in _resps(out_clean, "/api/v1/login")),
                        bf.responses_log(out_clean))
        clean_cookies = [r for r in out_clean if r.get("op") == "cookies"][0]["cookies"]
        self.assertFalse([c for c in clean_cookies if c["name"] == SESSION], clean_cookies)

        # -- STRICT withheld (document suppression, NOT proof): login then hostile
        # with runtime Strict shows [] + 401 cross-site.
        out_strict = self._browser([
            {"op": "goto", "url": self.api + "/"},
            {"op": "fill", "selector": "#token-input", "value": token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#whoami-text",
             "contains": self.fix.identity.user_id},
            {"op": "goto", "url": hurl},
            {"op": "waitForEval",
             "fn": "() => document.title.indexOf('ATK:') === 0"},
            {"op": "waitForEval",
             "fn": "() => new Promise((res) => setTimeout(() => res(true), 1000))"},
            {"op": "eval", "fn": "() => document.title"},
        ])
        grants_reqs = [q for q in _reqs(out_strict, "/grants") if vid in q["url"]]
        self.assertTrue(grants_reqs, "no strict grants POST")
        self.assertEqual(grants_reqs[0]["cookieNames"], [], grants_reqs[0])
        self.assertTrue(any(r["status"] == 401 for r in _resps(out_strict, "/grants")),
                        bf.responses_log(out_strict))

        # -- PLANTED None/Secure (TESTONLY, real TLS): forces dispatch, 403.
        out_login = self._browser([
            {"op": "goto", "url": self.api + "/"},
            {"op": "fill", "selector": "#token-input", "value": token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#whoami-text",
             "contains": self.fix.identity.user_id},
            {"op": "cookies", "urls": [self.api + "/"]},
        ])
        sess = [c for c in [r for r in out_login if r.get("op") == "cookies"][0]["cookies"]
                if c["name"] == SESSION]
        self.assertEqual(len(sess), 1, sess)
        val = sess[0]["value"]
        out = self._browser([
            {"op": "goto", "url": self.api + "/"},
            {"op": "setCookies", "cookies": [{"url": self.api + "/", "name": SESSION,
                                                    "value": val, "sameSite": "None",
                                                    "secure": True, "httpOnly": True}]},
            {"op": "cookies", "urls": [self.api + "/"]},
            {"op": "goto", "url": hurl},
            {"op": "waitForEval",
             "fn": "() => document.title.indexOf('ATK:') === 0"},
            {"op": "waitForEval",
             "fn": "() => new Promise((res) => setTimeout(() => res(true), 1000))"},
            {"op": "eval", "fn": "() => document.title"},
            {"op": "cookies", "urls": [self.api + "/", hurl]},
        ])
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs",
                                                           "requests", "responses", "console")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        planted = [r for r in out if r.get("op") == "cookies"][0]["cookies"]
        self.assertTrue(any(c["name"] == SESSION and (c["sameSite"] or "").lower() == "none"
                            for c in planted if c["url"] == self.api + "/"), planted)
        atk = json.loads([r for r in out if r.get("op") == "eval"][-1]["value"][4:])
        self.assertTrue(atk["grants"].startswith("BLOCKED"), atk)
        self.assertTrue(atk["logout"].startswith("BLOCKED"), atk)
        self.assertTrue(atk["login"].startswith("BLOCKED"), atk)
        self.assertEqual(atk["cookie"], "", atk)
        bf.assert_no_secrets_in_request_urls(self, out, [token, val])
        grants_reqs = [q for q in _reqs(out, "/grants") if vid in q["url"]]
        grants_req = [q for q in grants_reqs if q["origin"] == hostile_origin]
        self.assertTrue(grants_req, grants_reqs)
        self.assertEqual(grants_req[0]["cookieNames"], [SESSION], grants_req[0])
        self.assertIn("application/x-www-form-urlencoded",
                        grants_req[0]["headers"].get("Content-Type", ""))
        self.assertTrue(any(r["status"] == 403 for r in _resps(out, "/grants") if vid in r["url"]),
                        bf.responses_log(out))
        logout_req = [q for q in _reqs(out, "/api/v1/logout")
                      if q["method"] == "POST" and q["origin"] == hostile_origin]
        self.assertTrue(logout_req, bf.requests_log(out))
        self.assertEqual(logout_req[0]["cookieNames"], [SESSION], logout_req[0])
        self.assertTrue(any(r["status"] == 403 for r in _resps(out, "/api/v1/logout")),
                        bf.responses_log(out))
        # TARGETED state unchanged: victim info + exact bytes, session survives.
        # self.http carries the fixture TLS (insecure) context; bearer checks
        # need no jar and do not pollute the shared fixture jar.
        import ssl as _ssl
        insecure = _ssl.create_default_context()
        insecure.check_hostname = False
        insecure.verify_mode = _ssl.CERT_NONE
        info = self.http.request("GET", f"{self.api}/api/v1/artifacts/{vid}",
                                 headers=bearer)
        self.assertEqual(info.status, 200, info.body[:300])
        tls_content = (f"{self.api}/api/v1/artifacts/{vid}/files/"
                       + urllib.parse.quote("note.txt", safe="") + "/content")
        blob = self.http.request("GET", tls_content, headers=bearer)
        self.assertEqual(blob.status, 200, blob.body[:300])
        self.assertEqual(blob.body, b"tls victim bytes")
        # HTTP complements (urllib, no SameSite/preflight): fresh insecure jars.
        jar = bf.TestHttp(ssl_context=insecure)
        login_ok = jar.request("POST", self.api + "/api/v1/login",
                               body={"token": token},
                               headers={"Origin": self.api})
        self.assertEqual(login_ok.status, 200, login_ok.body[:300])
        self.assertTrue(jar.cookies_for(self.api))
        evil = {"Origin": "https://evil.example"}
        bad_grants = jar.request(
            "POST", f"{self.api}/api/v1/artifacts/{vid}/grants",
            body="x=1", content_type="application/x-www-form-urlencoded",
            headers=evil)
        self.assertEqual(bad_grants.status, 403, bad_grants.body[:300])
        still = jar.request("GET", self.api + "/api/v1/whoami")
        self.assertEqual(still.status, 200, still.body[:300])
        bad_login = bf.TestHttp(ssl_context=insecure).request(
            "POST", self.api + "/api/v1/login",
            body=urllib.parse.urlencode({"token": token}),
            content_type="application/x-www-form-urlencoded", headers=evil)
        self.assertEqual(bad_login.status, 403, bad_login.body[:300])
        self.assertEqual(bf.TestHttp(ssl_context=insecure).cookies_for(self.api), {})


if __name__ == "__main__":
    unittest.main()
