"""B1 / B7 / D1: dashboard login, CSRF origin enforcement, shell flows.

Real Chromium + real manure server. Static asset-hygiene checks run
without a server; all browser flows SkipTest until the server
implementation is synced (governor sync pending) rather than passing
vacuously.
"""

from __future__ import annotations

import json
import os
import sys
import time
import unittest
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import browser_fixtures as bf

REPO_MANURE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DASH_JS = os.path.join(REPO_MANURE_DIR, "web", "dashboard", "app.js")
DASH_HTML = os.path.join(REPO_MANURE_DIR, "web", "dashboard", "index.html")
UNLOCK_HTML = os.path.join(REPO_MANURE_DIR, "web", "unlock", "index.html")
UNLOCK_JS = os.path.join(REPO_MANURE_DIR, "web", "unlock", "unlock.js")
UNLOCK_CSS = os.path.join(REPO_MANURE_DIR, "web", "unlock", "styles.css")


class TestAssetHygiene(unittest.TestCase):
    """Static checks on the shipped shells (run pre-sync, no server)."""

    def _read(self, path):
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()

    def _code_text(self, src):
        import re
        src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
        src = re.sub(r"^\s*//.*$", "", src, flags=re.MULTILINE)
        return src

    def _code(self, path):
        import re
        with open(path, "r", encoding="utf-8") as fh:
            src = fh.read()
        # Strip comments so prose about a ban does not trip the check;
        # string literals remain (a banned call built via string concat
        # would still need the literal name... except split across
        # literals; the browser XSS tests cover actual exploitability).
        return self._code_text(src)

    def test_dashboard_js_never_injects_html_or_touches_storage(self):
        src = self._code(DASH_JS)
        for banned in ("innerHTML", "outerHTML", "insertAdjacentHTML",
                       "document.write", "localStorage", "sessionStorage",
                       "document.cookie"):
            self.assertNotIn(banned, src, f"dashboard app.js uses {banned}")

    def test_unlock_js_never_injects_html_or_touches_storage(self):
        src = self._code(UNLOCK_JS)
        for banned in ("innerHTML", "outerHTML", "insertAdjacentHTML",
                       "document.write", "localStorage", "sessionStorage",
                       "document.cookie"):
            self.assertNotIn(banned, src, f"unlock.js uses {banned}")

    def test_unlock_shell_uses_external_assets_only(self):
        # R3: external files served as trusted sibling assets while
        # locked; absolute same-origin paths resolve from both / and
        # /__manure/password. No inline script or style allowed.
        with open(UNLOCK_HTML, "r", encoding="utf-8") as fh:
            html = fh.read()
        self.assertIn('src="/unlock.js"', html)
        self.assertIn('href="/styles.css"', html)
        self.assertNotIn("<script>", html)
        self.assertNotIn("<style>", html)
        for path in (UNLOCK_JS, UNLOCK_CSS):
            self.assertTrue(os.path.isfile(path), path)

    def test_login_token_input_is_transient_password_field(self):
        html = self._read(DASH_HTML)
        self.assertIn('type="password"', html)
        self.assertIn('name="token"', html)
        for banned in ("localStorage", "sessionStorage"):
            self.assertNotIn(banned, html)

    def test_unlock_form_posts_urlencoded_to_own_origin(self):
        html = self._read(UNLOCK_HTML)
        self.assertIn('method="post"', html)
        self.assertIn('action="/__manure/unlock"', html)
        self.assertIn("application/x-www-form-urlencoded", html)
        self.assertIn('name="password"', html)
        self.assertIn('type="password"', html)

    def test_grant_handoff_is_form_post_not_url(self):
        src = self._read(DASH_JS)
        self.assertIn("/__manure/grant", src)
        self.assertIn('method', src)
        # The grant travels in a hidden form field, never in a URL.
        self.assertIn('name = "grant"', src)
        self.assertNotIn("grant=", src.replace('name = "grant"', ""))


def _api_host(url):
    return urllib.parse.urlsplit(url).hostname or ""


class DashboardFlows:
    suffix_mode = "sibling"

    @classmethod
    def setUpClass(cls):
        cls.fix = bf.start_server(suffix_mode=cls.suffix_mode)
        cls.http = cls.fix.http
        cls.api = cls.fix.api_base

    @classmethod
    def tearDownClass(cls):
        cls.fix.close()

    # -- helpers ------------------------------------------------------

    def login_steps(self, token):
        return [
            {"op": "goto", "url": self.api + "/"},
            {"op": "fill", "selector": "#token-input", "value": token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#whoami-text",
             "contains": self.fix.identity.user_id},
            {"op": "text", "selector": "#whoami-text"},
            {"op": "eval", "fn": "(s) => document.querySelector(s).value",
             "arg": "#token-input"},
            {"op": "localStorageKeys"},
            {"op": "cookies", "urls": [self.api + "/"]},
        ]

    # -- B1 ------------------------------------------------------------

    def test_b1_login_sets_session_cookie_and_clears_token(self):
        token = self.fix.identity.token
        out = bf.run_steps(self.login_steps(token))
        by_op = {r["op"]: r for r in out if r.get("ok")}
        self.assertTrue(by_op["goto"]["ok"])
        whoami = by_op["text"]["text"] or ""
        self.assertIn(self.fix.identity.user_id, whoami)
        # Transient credential: the field is cleared right after login.
        self.assertEqual(by_op["eval"]["value"], "")
        # No web storage use anywhere on the dashboard origin.
        self.assertEqual(by_op["localStorageKeys"]["keys"], [])
        self.assertEqual(by_op["localStorageKeys"]["sessionKeys"], [])
        cookies = by_op["cookies"]["cookies"]
        session = [c for c in cookies
                   if c["name"] in ("__Host-manure", "manure-dev")]
        self.assertEqual(len(session), 1, cookies)
        sess = session[0]
        self.assertTrue(sess["httpOnly"], sess)
        self.assertEqual(sess["path"], "/")
        self.assertEqual((sess["sameSite"] or "").lower(), "strict")
        # No Domain attribute: the cookie host must equal the API host,
        # never a shared parent suffix.
        self.assertEqual(sess["domain"], _api_host(self.api), sess)

    def test_b1_login_requires_exact_origin_http(self):
        jar = bf.TestHttp()
        res = jar.request("POST", self.api + "/api/v1/login",
                          body={"token": self.fix.identity.token})
        self.assertEqual(res.status, 403, res.body[:300])
        self.assertEqual(jar.cookies_for(self.api), {})
        bad = jar.request("POST", self.api + "/api/v1/login",
                          body={"token": self.fix.identity.token},
                          headers={"Origin": "https://evil.example"})
        self.assertEqual(bad.status, 403, bad.body[:300])
        self.assertEqual(jar.cookies_for(self.api), {})
        wrong = jar.request("POST", self.api + "/api/v1/login",
                            body={"token": bf.canonical_secret()},
                            headers={"Origin": self.api})
        self.assertEqual(wrong.status, 401, wrong.body[:300])
        self.assertEqual(jar.cookies_for(self.api), {})

    # -- shell + API normative headers (contract section 5.5) ----------

    def test_b1_dashboard_shell_csp_allows_content_suffix(self):
        res = self.http.request("GET", self.api + "/")
        self.assertEqual(res.status, 200, res.body[:300])
        csp = res.header("Content-Security-Policy") or ""
        self.assertIn("form-action 'self'", csp, csp)
        # Contract review clarification: the wildcard entry carries the
        # effective content port when non-default (bare suffix only for
        # default-port production origins).
        parts = urllib.parse.urlsplit(self.api)
        scheme = parts.scheme
        port = parts.port
        default_port = (scheme == "http" and port in (None, 80)) or \
            (scheme == "https" and port in (None, 443))
        expected_entry = f"{scheme}://*.{self.fix.suffix}"
        if not default_port:
            expected_entry += f":{port}"
        self.assertIn(expected_entry, csp, csp)
        self.assertIn("frame-ancestors 'none'", csp, csp)
        self.assertIn("base-uri 'none'", csp, csp)
        self.assertIn("object-src 'none'", csp, csp)
        self.assertNotIn("* ", csp.replace(expected_entry, ""),
                         f"overbroad CSP source: {csp}")
        self.assertEqual(res.header("Origin-Agent-Cluster"), "?1")
        self.assertEqual(res.header("X-Content-Type-Options"), "nosniff")
        # Codified exception (governor decision on reproduced D2): shells
        # that submit navigational forms use origin-only Referrer-Policy
        # so Chromium sends the real Origin (no-referrer yields
        # Origin:null on form POSTs and breaks exact-Origin CSRF checks).
        # Uploaded bytes and API responses keep no-referrer.
        self.assertEqual(res.header("Referrer-Policy"), "strict-origin")
        self.assertEqual(
            res.header("Cross-Origin-Opener-Policy"), "same-origin")
        self.assertEqual(
            res.header("Cross-Origin-Resource-Policy"), "same-origin")
        self.assertIsNone(res.header("Access-Control-Allow-Origin"))

    def test_b1_api_dynamic_responses_carry_security_headers(self):
        res = self.http.request(
            "GET", self.api + "/api/v1/whoami",
            headers={"Authorization": f"Bearer {self.fix.identity.token}"})
        self.assertEqual(res.status, 200, res.body[:300])
        self.assertEqual(res.header("Cache-Control"), "no-store")
        self.assertEqual(res.header("Origin-Agent-Cluster"), "?1")
        self.assertEqual(res.header("Referrer-Policy"), "no-referrer")
        self.assertEqual(res.header("X-Content-Type-Options"), "nosniff")
        self.assertIsNone(res.header("Access-Control-Allow-Origin"))

    # -- B7 ------------------------------------------------------------

    def test_b7_wrong_origin_mutation_with_planted_cookie_changes_nothing(self):
        created = bf.upload_fixture(
            self.fix, name="csrf-probe", kind="file",
            visibility="internal", files={"note.txt": b"csrf probe"})
        aid = created["artifact_id"]
        # Plant a genuine session cookie, then attack cross-origin.
        jar = bf.TestHttp()
        login = jar.request("POST", self.api + "/api/v1/login",
                            body={"token": self.fix.identity.token},
                            headers={"Origin": self.api})
        self.assertEqual(login.status, 200, login.body[:300])
        self.assertTrue(jar.cookies_for(self.api), "login set no cookie")
        evil = {"Origin": "https://evil.example"}
        delete = jar.request("DELETE",
                             f"{self.api}/api/v1/artifacts/{aid}",
                             headers=evil)
        self.assertEqual(delete.status, 403, delete.body[:300])
        no_origin = jar.request("DELETE",
                                f"{self.api}/api/v1/artifacts/{aid}")
        self.assertEqual(no_origin.status, 403, no_origin.body[:300])
        # State unchanged: the artifact is still readable.
        fresh = bf.TestHttp()
        info = fresh.request(
            "GET", f"{self.api}/api/v1/artifacts/{aid}",
            headers={"Authorization": f"Bearer {self.fix.identity.token}"})
        self.assertEqual(info.status, 200, info.body[:300])
        cleanup = fresh.request(
            "DELETE", f"{self.api}/api/v1/artifacts/{aid}",
            headers={"Authorization": f"Bearer {self.fix.identity.token}"})
        self.assertEqual(cleanup.status, 200, cleanup.body[:300])

    # -- D1 --------------------------------------------------------------

    def test_d1_list_detail_delete_with_hostile_name(self):
        hostile = "<img src=x onerror=alert('xss')>houyhnhnm"
        created = bf.upload_fixture(
            self.fix, name=hostile, kind="file",
            visibility="internal", files={"note.txt": b"hostile name probe"})
        aid = created["artifact_id"]
        token = self.fix.identity.token
        out = bf.run_steps([
            {"op": "goto", "url": self.api + "/"},
            {"op": "fill", "selector": "#token-input", "value": token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "shown"},
            {"op": "text", "selector": "#list-status"},
            # The hostile name must render as inert text: no img element
            # is created anywhere in the list.
            {"op": "count", "selector": "#artifact-list img"},
            {"op": "count", "selector": "#artifact-list script"},
            {"op": "text", "selector": "#artifact-list"},
            {"op": "eval", "fn": "(id) => !!document.querySelector("
                                 "`button[data-action=details][data-artifact-id=\"${id}\"]`)",
             "arg": aid},
            {"op": "eval", "fn": "(id) => { document.querySelector("
                                 "`button[data-action=details][data-artifact-id=\"${id}\"]`).click();"
                                 " return true; }",
             "arg": aid},
            {"op": "waitForText", "selector": "#detail-list",
             "contains": aid},
            {"op": "text", "selector": "#detail-list"},
            {"op": "click", "selector": "#delete-button"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "shown"},
            {"op": "text", "selector": "#list-status"},
        ])
        by_op = {r["op"] + str(i): r for i, r in enumerate(out)}
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        counts = [r for r in out if r.get("op") == "count"]
        self.assertEqual(counts[0]["count"], 0, "hostile name created an <img>")
        self.assertEqual(counts[1]["count"], 0, "hostile name created a <script>")
        texts = [r for r in out if r.get("op") == "text"]
        self.assertIn(hostile, texts[1]["text"], "hostile name missing from list text")
        self.assertIn(aid, texts[2]["text"], "artifact id missing from detail")
        # A delete confirmation dialog appeared and was accepted.
        dialogs = [r for r in out if r.get("op") == "dialogs"][0]["dialogs"]
        self.assertTrue(any("Delete artifact" in d["message"] for d in dialogs), dialogs)
        # Server state: the artifact is gone.
        info = self.http.request(
            "GET", f"{self.api}/api/v1/artifacts/{aid}",
            headers={"Authorization": f"Bearer {self.fix.identity.token}"})
        self.assertEqual(info.status, 404, info.body[:300])

    def test_d1_rotate_reveals_once_and_clears_on_dismiss(self):
        created = bf.upload_fixture(
            self.fix, name="rotate-probe", kind="file",
            visibility="external", files={"note.txt": b"rotate probe"})
        aid = created["artifact_id"]
        first_password = created.get("external_password")
        self.assertTrue(first_password, "init did not return an external password")
        token = self.fix.identity.token
        out = bf.run_steps([
            {"op": "goto", "url": self.api + "/"},
            {"op": "fill", "selector": "#token-input", "value": token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "shown"},
            {"op": "eval", "fn": "(id) => { document.querySelector("
                                 "`button[data-action=details][data-artifact-id=\"${id}\"]`).click();"
                                 " return true; }",
             "arg": aid},
            {"op": "waitForText", "selector": "#detail-list",
             "contains": aid},
            {"op": "click", "selector": "#rotate-button"},
            {"op": "waitForEval",
             "fn": "() => document.querySelector('#rotate-password')"
                   " .textContent.length === 43"},
            {"op": "text", "selector": "#rotate-password"},
            {"op": "localStorageKeys"},
            {"op": "click", "selector": "#rotate-dismiss-button"},
            {"op": "text", "selector": "#rotate-password"},
        ])
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        texts = [r for r in out if r.get("op") == "text"]
        revealed = texts[0]["text"] or ""
        self.assertEqual(len(revealed), 43, "rotated password not revealed once")
        self.assertNotEqual(revealed, first_password, "rotation reused the password")
        keys = [r for r in out if r.get("op") == "localStorageKeys"][0]
        self.assertEqual(keys["keys"], [])
        self.assertEqual(keys["sessionKeys"], [])
        self.assertEqual(texts[1]["text"] or "", "",
                         "password not cleared on dismiss")

    def test_a1_logout_clears_revealed_password_dom(self):
        created = bf.upload_fixture(
            self.fix, name="a1-probe", kind="file",
            visibility="external", files={"note.txt": b"a1"})
        aid = created["artifact_id"]
        token = self.fix.identity.token
        out = bf.run_steps([
            {"op": "goto", "url": self.api + "/"},
            {"op": "fill", "selector": "#token-input", "value": token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "shown"},
            {"op": "eval", "fn": "(id) => { document.querySelector("
                                 "`button[data-action=details][data-artifact-id=\"${id}\"]`).click();"
                                 " return true; }",
             "arg": aid},
            {"op": "waitForText", "selector": "#detail-list",
             "contains": aid},
            {"op": "click", "selector": "#rotate-button"},
            {"op": "waitForEval",
             "fn": "() => document.querySelector('#rotate-password')"
                   " .textContent.length === 43"},
            {"op": "click", "selector": "#logout-button"},
            {"op": "waitForText", "selector": "#login-heading",
             "contains": "Log in"},
            {"op": "eval", "fn": "() => JSON.stringify({"
                                 "pw: document.querySelector('#rotate-password').textContent,"
                                 " detailHidden: document.querySelector('#detail-section').hidden,"
                                 " loginVisible: !document.querySelector('#login-section').hidden})"},
        ])
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs",
                                                           "requests", "console")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        state = json.loads([r for r in out if r.get("op") == "eval"][-1]["value"])
        self.assertEqual(state["pw"], "", "rotated password left in DOM")
        self.assertTrue(state["detailHidden"])
        self.assertTrue(state["loginVisible"])

    def test_a2_detail_failure_is_visible_in_list(self):
        created = bf.upload_fixture(
            self.fix, name="a2-probe", kind="file",
            visibility="internal", files={"note.txt": b"a2"})
        aid = created["artifact_id"]
        token = self.fix.identity.token
        out = bf.run_steps([
            {"op": "goto", "url": self.api + "/"},
            {"op": "fill", "selector": "#token-input", "value": token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "shown"},
            # Vanish between list and click: delete via same-origin
            # fetch, then open details that can no longer load.
            {"op": "eval", "fn": "(id) => fetch(`/api/v1/artifacts/${id}`,"
                                 " {method:'DELETE', credentials:'same-origin'})"
                                 ".then((r) => { if (!r.ok) throw new Error('delete:'+r.status);"
                                 " document.querySelector("
                                 "`button[data-action=details][data-artifact-id=\"${id}\"]`).click();"
                                 " return true; })",
             "arg": aid},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "Detail failed"},
            {"op": "text", "selector": "#list-status"},
            {"op": "eval", "fn": "() => JSON.stringify({"
                                 " dashVisible: !document.querySelector('#dashboard-section').hidden,"
                                 " detailHidden: document.querySelector('#detail-section').hidden})"},
        ])
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs",
                                                           "requests", "console")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        texts = [r for r in out if r.get("op") == "text"]
        self.assertIn("Detail failed", texts[0]["text"] or "")
        state = json.loads([r for r in out if r.get("op") == "eval"][-1]["value"])
        self.assertTrue(state["dashVisible"], "left list view on failed details")
        self.assertTrue(state["detailHidden"])


    # -- R1 adversarial sibling + open branches ----------------------------

    def test_b7_hostile_sibling_js_cannot_mutate_dashboard(self):
        """Uploaded sibling JS runs with the victim's cookies in the jar:
        its dashboard reads must fail closed and its state-changing
        POSTs must reach the server (simple requests, no preflight) yet
        leave state unchanged under exact-Origin enforcement."""
        token = self.fix.identity.token
        bearer = {"Authorization": f"Bearer {token}"}
        victim = bf.upload_fixture(
            self.fix, name="csrf-victim", kind="file",
            visibility="internal", files={"note.txt": b"victim bytes"})
        vid = victim["artifact_id"]
        # R1: hostile JS uses OTHERWISE-VALID login credentials (stolen
        # victim token, not random) and TARGETS the victim artifact via a
        # SIMPLE same-site POST (grants, urlencoded, no preflight) so the
        # browser actually dispatches with Origin+Cookie and the server must
        # return 403 (not 401/preflight-only/CSP). DELETE would preflight and
        # never dispatch, so it is covered only by the HTTP complements below.
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
            self.fix, name="hostile-sib", kind="dir",
            visibility="public", files={"index.html": hostile_html})
        hurl = bf.content_url_for(self.fix, hostile["artifact_id"])
        hostile_origin = "{0.scheme}://{0.netloc}".format(
            urllib.parse.urlsplit(hurl))
        SESSION_NAMES = ("__Host-manure", "manure-dev")
        grants_suffix = f"/api/v1/artifacts/{vid}/grants"

        def _reqs(out, suffix):
            return [q for q in bf.requests_log(out)
                    if q["url"].endswith(suffix)]

        def _resps(out, suffix):
            return [r for r in bf.responses_log(out)
                    if r["url"].endswith(suffix)]

        # -- CLEAN run: hostile JS with OTHERWISE-VALID credentials in a
        # clean context must get wrong-Origin 403 and create NO session.
        # No cookie is dispatched (clean jar), so SameSite cannot suppress:
        # this holds in BOTH sibling and separate modes without planting.
        out_clean = bf.run_steps([
            {"op": "goto", "url": hurl},
            {"op": "waitForEval",
             "fn": "() => document.title.indexOf('ATK:') === 0"},
            # Settle for CDP ExtraInfo (Origin/Cookie/response 403) which
            # arrives asynchronously after fetch BLOCKED; without this the
            # request may show incomplete headers (origin None).
            {"op": "waitForEval",
             "fn": "() => new Promise((res) => setTimeout(() => res(true), 1000))"},
            {"op": "eval", "fn": "() => document.title"},
            {"op": "cookies", "urls": [self.api + "/", hurl]},
        ])
        results_clean = [r for r in out_clean
                         if r.get("op") not in ("pageerrors", "dialogs",
                                                   "requests", "responses", "console")]
        self.assertTrue(all(r.get("ok") for r in results_clean),
                        [r for r in results_clean if not r.get("ok")])
        atk_clean = json.loads(
            [r for r in out_clean if r.get("op") == "eval"][-1]["value"][4:])
        self.assertTrue(atk_clean["read"].startswith("BLOCKED"), atk_clean)
        self.assertTrue(atk_clean["grants"].startswith("BLOCKED"), atk_clean)
        self.assertTrue(atk_clean["logout"].startswith("BLOCKED"), atk_clean)
        self.assertTrue(atk_clean["login"].startswith("BLOCKED"), atk_clean)
        self.assertEqual(atk_clean["cookie"], "", atk_clean)
        self.assertEqual(atk_clean["storage"], "0,0", atk_clean)
        bf.assert_no_secrets_in_request_urls(self, out_clean, [token])
        clean_login_reqs = _reqs(out_clean, "/api/v1/login")
        self.assertTrue(clean_login_reqs, "no browser login POST dispatched")
        # Complete headers (redacted) + wrong Origin, no cookie in clean jar.
        login_req = [q for q in clean_login_reqs
                     if q["method"] == "POST" and q["origin"] == hostile_origin]
        self.assertTrue(login_req, clean_login_reqs)
        self.assertEqual(login_req[0]["cookieNames"], [], login_req[0])
        self.assertEqual(login_req[0]["headers"].get("Origin"), hostile_origin)
        self.assertIn("application/x-www-form-urlencoded",
                        login_req[0]["headers"].get("Content-Type", ""))
        clean_login_resps = _resps(out_clean, "/api/v1/login")
        self.assertTrue(any(r["status"] == 403 for r in clean_login_resps),
                        clean_login_resps)
        # No session creation: no session cookie for the API origin and no
        # session Set-Cookie on the 403.
        clean_cookies = [r for r in out_clean if r.get("op") == "cookies"][0]["cookies"]
        self.assertFalse([c for c in clean_cookies
                          if c["url"] == self.api + "/"
                          and c["name"] in SESSION_NAMES],
                         clean_cookies)
        for r in clean_login_resps:
            if r["status"] == 403:
                self.assertFalse(set(r["setCookieNames"]) & set(SESSION_NAMES), r)

        # -- AUTH run: victim logs in, then hostile JS runs with the jar.
        # Simple POSTs (urlencoded) dispatch without preflight; the CDP log
        # proves they are not preflight-only (Origin+Cookie present) and the
        # response log proves the server's 403 (not 401/CSP/never-dispatched).
        out = bf.run_steps([
            {"op": "goto", "url": self.api + "/"},
            {"op": "fill", "selector": "#token-input", "value": token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "shown"},
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
        atk = json.loads([r for r in out if r.get("op") == "eval"][-1]["value"][4:])
        # Reads fail closed (CORS, no ACAO) and no dashboard credential
        # material is visible to page JS.
        self.assertTrue(atk["read"].startswith("BLOCKED"), atk)
        self.assertTrue(atk["grants"].startswith("BLOCKED"), atk)
        self.assertTrue(atk["logout"].startswith("BLOCKED"), atk)
        self.assertTrue(atk["login"].startswith("BLOCKED"), atk)
        self.assertEqual(atk["cookie"], "", atk)
        self.assertEqual(atk["storage"], "0,0", atk)
        bf.assert_no_secrets_in_request_urls(self, out, [token])
        # The simple POSTs were actually dispatched (request log proves
        # they are not preflight-only passes) ...
        posts = [q for q in bf.requests_log(out)
                 if q["method"] == "POST" and "/api/v1/" in q["url"]]
        self.assertTrue(any(q["url"].endswith("/api/v1/logout") for q in posts),
                        posts)
        self.assertTrue(any(q["url"].endswith("/grants") and vid in q["url"]
                            for q in posts), posts)
        # Mutation dispatch with VALID victim cookie, wrong Origin, server 403.
        # Sibling (same-site) dispatches Strict directly; separate
        # (cross-site) withholds Strict over HTTP (401, correctly reported as
        # [] via blockedReasons, never masqueraded as 403). The separate 403
        # proof lives in the TLS planting test (None/Secure, real TLS) and in
        # the HTTP complements below (urllib has no SameSite); see R1.
        grants_reqs = [q for q in _reqs(out, "/grants") if vid in q["url"]]
        self.assertTrue(grants_reqs, "no browser grants POST to victim")
        grants_req = [q for q in grants_reqs if q["origin"] == hostile_origin]
        self.assertTrue(grants_req, grants_reqs)
        grants_resps = [r for r in _resps(out, "/grants") if vid in r["url"]]
        logout_req = [q for q in _reqs(out, "/api/v1/logout")
                      if q["method"] == "POST" and q["origin"] == hostile_origin]
        self.assertTrue(logout_req, posts)
        logout_resps = _resps(out, "/api/v1/logout")
        if self.suffix_mode == "sibling":
            self.assertEqual(grants_req[0]["cookieNames"], ["manure-dev"],
                             grants_req[0])
            self.assertTrue(any(r["status"] == 403 for r in grants_resps),
                            grants_resps)
            self.assertEqual(logout_req[0]["cookieNames"], ["manure-dev"],
                             logout_req[0])
            self.assertTrue(any(r["status"] == 403 for r in logout_resps),
                            logout_resps)
        else:
            # Separate HTTP: Strict withheld cross-site (SameSite). The CDP
            # helper correctly reports [] (blocked, not sent) and the server
            # answers 401 (unauthenticated), which is NOT an Origin proof.
            self.assertEqual(grants_req[0]["cookieNames"], [], grants_req[0])
            self.assertTrue(any(r["status"] == 401 for r in grants_resps),
                            grants_resps)
            self.assertEqual(logout_req[0]["cookieNames"], [], logout_req[0])
            self.assertTrue(any(r["status"] == 401 for r in logout_resps),
                            logout_resps)
        # ... yet the victim session survives: replay the observed
        # session cookie (harness privilege, not page JS) and prove it
        # still works, while the same requests with a wrong Origin fail.
        cookies = [r for r in out if r.get("op") == "cookies"][0]["cookies"]
        session = [c for c in cookies
                   if c["url"] == self.api + "/"
                   and c["name"] in ("__Host-manure", "manure-dev")]
        self.assertEqual(len(session), 1, cookies)
        jar = bf.TestHttp()
        jar.set_cookie(self.api, session[0]["name"], session[0]["value"])
        who = jar.request("GET", self.api + "/api/v1/whoami")
        self.assertEqual(who.status, 200, who.body[:300])
        evil = {"Origin": "https://evil.example"}
        bad_logout = jar.request("POST", self.api + "/api/v1/logout",
                                 headers=evil)
        self.assertEqual(bad_logout.status, 403, bad_logout.body[:300])
        still = jar.request("GET", self.api + "/api/v1/whoami")
        self.assertEqual(still.status, 200, still.body[:300])
        bad_delete = jar.request("DELETE",
                                 f"{self.api}/api/v1/artifacts/{vid}",
                                 headers=evil)
        self.assertEqual(bad_delete.status, 403, bad_delete.body[:300])
        # HTTP complements for the browser grants/login proofs above
        # (urllib has no SameSite/preflight/CSP, so separate 403 is direct).
        bad_grants = jar.request(
            "POST", f"{self.api}/api/v1/artifacts/{vid}/grants",
            body="x=1", content_type="application/x-www-form-urlencoded",
            headers=evil)
        self.assertEqual(bad_grants.status, 403, bad_grants.body[:300])
        still2 = jar.request("GET", self.api + "/api/v1/whoami")
        self.assertEqual(still2.status, 200, still2.body[:300])
        # Valid login with wrong Origin is 403 with NO session (HTTP).
        clean_jar = bf.TestHttp()
        bad_login = clean_jar.request(
            "POST", self.api + "/api/v1/login",
            body=urllib.parse.urlencode({"token": token}),
            content_type="application/x-www-form-urlencoded",
            headers=evil)
        self.assertEqual(bad_login.status, 403, bad_login.body[:300])
        self.assertEqual(clean_jar.cookies_for(self.api), {})
        # Meaningful TARGETED state unchanged: victim info + exact bytes.
        intact = self.http.request(
            "GET", f"{self.api}/api/v1/artifacts/{vid}", headers=bearer)
        self.assertEqual(intact.status, 200, intact.body[:300])
        api_content = (f"{self.api}/api/v1/artifacts/{vid}/files/"
                       + urllib.parse.quote("note.txt", safe="") + "/content")
        blob = self.http.request("GET", api_content, headers=bearer)
        self.assertEqual(blob.status, 200, blob.body[:300])
        self.assertEqual(blob.body, b"victim bytes")

    def test_d1_open_public_and_external_from_dashboard(self):
        """Dashboard Open branches that need no grant: public navigates
        straight to the bytes, external lands on the password form."""
        token = self.fix.identity.token
        pub = bf.upload_fixture(
            self.fix, name="open-pub", kind="dir",
            visibility="public",
            files={"index.html": b"<h1>public landing</h1>"})
        ext = bf.upload_fixture(
            self.fix, name="open-ext", kind="dir",
            visibility="external",
            files={"index.html": b"<h1>external landing</h1>"})
        pub_url = bf.content_url_for(self.fix, pub["artifact_id"])
        ext_url = bf.content_url_for(self.fix, ext["artifact_id"])
        out = bf.run_steps([
            {"op": "goto", "url": self.api + "/"},
            {"op": "fill", "selector": "#token-input", "value": token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "shown"},
            {"op": "click",
             "selector": "button[data-action=open][data-artifact-id=\"" +
                         pub["artifact_id"] + "\"]"},
            {"op": "waitForText", "selector": "h1",
             "contains": "public landing"},
            {"op": "eval", "fn": "() => location.href"},
            {"op": "goto", "url": self.api + "/"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "shown"},
            {"op": "click",
             "selector": "button[data-action=open][data-artifact-id=\"" +
                         ext["artifact_id"] + "\"]"},
            {"op": "waitForText", "selector": "h1",
             "contains": "Protected artifact"},
            {"op": "eval", "fn": "() => location.href"},
        ])
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs",
                                                           "requests", "console")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        hrefs = [r["value"] for r in out if r.get("op") == "eval"]
        pub_host = urllib.parse.urlsplit(pub_url).hostname or ""
        ext_host = urllib.parse.urlsplit(ext_url).hostname or ""
        self.assertIn(pub_host, hrefs[0])
        self.assertNotIn("grant", hrefs[0])
        self.assertIn(ext_host, hrefs[1])


class ExpiredDeleteCase(unittest.TestCase):
    """A2: expired artifacts listed via include-expired stay deletable
    from the list (their info reads 410, so detail-only delete strands
    them). Uses the private test clock; sibling suffix is enough (the
    flow is origin-independent once listed)."""

    @classmethod
    def setUpClass(cls):
        cls.clock = [time.time()]
        cls.fix = bf.start_server(suffix_mode="sibling",
                                  now_fn=lambda: cls.clock[0])
        cls.http = cls.fix.http
        cls.api = cls.fix.api_base

    @classmethod
    def tearDownClass(cls):
        cls.fix.close()

    def test_a2_expired_artifact_can_be_deleted_from_list(self):
        token = self.fix.identity.token
        bearer = {"Authorization": f"Bearer {token}"}
        created = bf.upload_fixture(
            self.fix, name="a2-expired", kind="file",
            visibility="internal", files={"note.txt": b"a2exp"},
            expires_in_s=60)
        aid = created["artifact_id"]
        self.clock[0] += 120
        info = self.http.request("GET", f"{self.api}/api/v1/artifacts/{aid}",
                                 headers=bearer)
        self.assertEqual(info.status, 410, info.body[:300])
        out = bf.run_steps([
            {"op": "goto", "url": self.api + "/"},
            {"op": "fill", "selector": "#token-input", "value": token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "shown"},
            {"op": "click", "selector": "#include-expired"},
            {"op": "waitForText", "selector": "#artifact-list",
             "contains": aid},
            {"op": "click",
             "selector": "button[data-action=delete][data-artifact-id=\"" + aid + "\"]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "shown"},
        ])
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs",
                                                           "requests", "console")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        dialogs = [r for r in out if r.get("op") == "dialogs"][0]["dialogs"]
        self.assertTrue(any("Delete artifact" in d["message"] for d in dialogs),
                        dialogs)
        gone = self.http.request("GET", f"{self.api}/api/v1/artifacts/{aid}",
                                 headers=bearer)
        self.assertEqual(gone.status, 404, gone.body[:300])


class DashboardSiblingCase(DashboardFlows, unittest.TestCase):
    suffix_mode = "sibling"


class DashboardSeparateCase(DashboardFlows, unittest.TestCase):
    """B7 must hold on a separate content domain as well."""
    suffix_mode = "separate"


if __name__ == "__main__":
    unittest.main()
