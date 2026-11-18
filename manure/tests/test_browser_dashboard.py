"""B1 / B7 / D1: dashboard login, CSRF origin enforcement, shell flows.

Real Chromium + real manure server.
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
            {"op": "fill", "selector": "[data-account-login] input[name=login]", "value": self.fix.identity.login},
            {"op": "fill", "selector": "[data-account-login] input[name=password]", "value": self.fix.identity.password},
            {"op": "click", "selector": "[data-account-login] button[type=submit]"},
            {"op": "waitForText", "selector": "#whoami-text",
             "contains": self.fix.identity.user_id},
            {"op": "text", "selector": "#whoami-text"},
            {"op": "eval", "fn": "(s) => document.querySelector(s)?.value ?? ''",
             "arg": "[data-account-login] input[name=password]"},
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
        res = jar.login(self.api, self.fix.identity.login, self.fix.identity.password, headers={})
        self.assertEqual(res.status, 403, res.body[:300])
        self.assertEqual(jar.cookies_for(self.api), {})
        bad = jar.login(self.api, self.fix.identity.login, self.fix.identity.password, headers={"Origin": "https://evil.example"})
        self.assertEqual(bad.status, 403, bad.body[:300])
        self.assertEqual(jar.cookies_for(self.api), {})
        wrong = jar.login(self.api, self.fix.identity.login, bf.canonical_secret(), headers={"Origin": self.api})
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
        res = self.http.current((self.api), bf.cp.Command_Whoami(), headers={"Authorization": f"Bearer {self.fix.identity.token}"})
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
        login = jar.login(self.api, self.fix.identity.login, self.fix.identity.password, headers={"Origin": self.api})
        self.assertEqual(login.status, 200, login.body[:300])
        self.assertTrue(jar.cookies_for(self.api), "login set no cookie")
        evil = {"Origin": "https://evil.example"}
        delete = jar.current((self.api), bf.cp.Command_DeleteArtifact(aid), headers=evil)
        self.assertEqual(delete.status, 403, delete.body[:300])
        no_origin = jar.current((self.api), bf.cp.Command_DeleteArtifact(aid))
        self.assertEqual(no_origin.status, 403, no_origin.body[:300])
        # State unchanged: the artifact is still readable.
        fresh = bf.TestHttp()
        info = fresh.current((self.api), bf.cp.Command_GetArtifact(aid), headers={"Authorization": f"Bearer {self.fix.identity.token}"})
        self.assertEqual(info.status, 200, info.body[:300])
        cleanup = fresh.current((self.api), bf.cp.Command_DeleteArtifact(aid), headers={"Authorization": f"Bearer {self.fix.identity.token}"})
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
            {"op": "fill", "selector": "[data-account-login] input[name=login]", "value": self.fix.identity.login},
            {"op": "fill", "selector": "[data-account-login] input[name=password]", "value": self.fix.identity.password},
            {"op": "click", "selector": "[data-account-login] button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "loaded"},
            {"op": "text", "selector": "#list-status"},
            # The hostile name must render as inert text: no img element
            # is created anywhere in the list.
            {"op": "count", "selector": "#artifact-list img"},
            {"op": "count", "selector": "#artifact-list script"},
            {"op": "text", "selector": "#artifact-list"},
            {"op": "eval", "fn": "(id) => !!document.querySelector("
                                 "`a[data-action=details][data-artifact-id=\"${id}\"]`)",
             "arg": aid},
            {"op": "eval", "fn": "(id) => { document.querySelector("
                                 "`a[data-action=details][data-artifact-id=\"${id}\"]`).click();"
                                 " return true; }",
             "arg": aid},
            {"op": "waitForText", "selector": "#detail-list",
             "contains": aid},
            {"op": "text", "selector": "#detail-list"},
            {"op": "click", "selector": "#delete-button"},
            {"op": "click", "selector": "dialog[open] >> role=button[name=\"Delete artifact\"]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "loaded"},
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
        # Deletion was confirmed in the in-app dialog; no native dialog appeared.
        dialogs = [r for r in out if r.get("op") == "dialogs"][0]["dialogs"]
        self.assertEqual(dialogs, [])
        # Server state: the artifact is gone.
        info = self.http.current((self.api), bf.cp.Command_GetArtifact(aid), headers={"Authorization": f"Bearer {self.fix.identity.token}"})
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
            {"op": "fill", "selector": "[data-account-login] input[name=login]", "value": self.fix.identity.login},
            {"op": "fill", "selector": "[data-account-login] input[name=password]", "value": self.fix.identity.password},
            {"op": "click", "selector": "[data-account-login] button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "loaded"},
            {"op": "eval", "fn": "(id) => { document.querySelector("
                                 "`a[data-action=details][data-artifact-id=\"${id}\"]`).click();"
                                 " return true; }",
             "arg": aid},
            {"op": "waitForText", "selector": "#detail-list",
             "contains": aid},
            {"op": "click", "selector": "#rotate-button"},
            {"op": "click", "selector": "dialog[open] >> role=button[name=\"Rotate password\"]"},
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
            {"op": "fill", "selector": "[data-account-login] input[name=login]", "value": self.fix.identity.login},
            {"op": "fill", "selector": "[data-account-login] input[name=password]", "value": self.fix.identity.password},
            {"op": "click", "selector": "[data-account-login] button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "loaded"},
            {"op": "eval", "fn": "(id) => { document.querySelector("
                                 "`a[data-action=details][data-artifact-id=\"${id}\"]`).click();"
                                 " return true; }",
             "arg": aid},
            {"op": "waitForText", "selector": "#detail-list",
             "contains": aid},
            {"op": "click", "selector": "#rotate-button"},
            {"op": "click", "selector": "dialog[open] >> role=button[name=\"Rotate password\"]"},
            {"op": "waitForEval",
             "fn": "() => document.querySelector('#rotate-password')"
                   " .textContent.length === 43"},
            {"op": "click", "selector": "#user-menu-button"},
            {"op": "click", "selector": "#logout-button"},
            {"op": "waitForText", "selector": "#login-section h1",
             "contains": "Sign in"},
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
            {"op": "fill", "selector": "[data-account-login] input[name=login]", "value": self.fix.identity.login},
            {"op": "fill", "selector": "[data-account-login] input[name=password]", "value": self.fix.identity.password},
            {"op": "click", "selector": "[data-account-login] button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "loaded"},
            # Vanish between list and click: delete via same-origin
            # fetch, then open details that can no longer load.
            {"op": "eval", "fn": "(id) => fetch('/api/current',"
                                 " {method:'POST', credentials:'same-origin',headers:{'Content-Type':'application/json'},"
                                 " body:JSON.stringify({requestId:crypto.randomUUID(),apiVersion:'1.0.0',command:{DeleteArtifact:{artifactId:id}}})})"
                                 ".then((r) => { if (!r.ok) throw new Error('delete:'+r.status);"
                                 " document.querySelector("
                                 "`a[data-action=details][data-artifact-id=\"${id}\"]`).click();"
                                 " return true; })",
             "arg": aid},
            {"op": "waitForText", "selector": "#list-notice",
             "contains": "Detail failed"},
            {"op": "text", "selector": "#list-notice"},
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
        its JSON operations must fail preflight and stay unreadable. Simple
        form POSTs dispatch; authenticated wrong-Origin forms must return403.
        Every response is joined to its exact request/phase, not a shared URL."""
        token = self.fix.identity.token
        bearer = {"Authorization": f"Bearer {token}"}
        victim = bf.upload_fixture(
            self.fix, name="csrf-victim", kind="file",
            visibility="internal", files={"note.txt": b"victim bytes"})
        vid = victim["artifact_id"]
        # R1: hostile JS uses OTHERWISE-VALID login credentials (stolen
        # victim token, not random) and TARGETS the victim artifact via a
        # JSON CreateGrant/List require preflight in the CURRENT protocol;
        # they are NOT dispatched simple-form Origin proofs. Login/logout
        # forms still dispatch. Raw HTTP complements send otherwise-valid
        # typed mutations and cookie forms without CORS/SameSite shielding.
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
            "  const envelope = command => JSON.stringify({requestId:crypto.randomUUID(),apiVersion:'1.0.0',command});"
            "  await attempt('read', base + '/api/current',"
            "    {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},"
            "     body:envelope({ListArtifacts:{query:{query:'',includeExpired:false,visibility:null,state:null,sort:'CreatedAt',direction:'Desc',limit:50,cursor:null}}})});"
            "  await attempt('grants', base + '/api/current',"
            "    {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},"
            "     body:envelope({CreateGrant:{artifactId:vid}})});"
            "  await attempt('logout', base + '/api/current/logout',"
            "    {method:'POST', credentials:'include',"
            "     headers:{'Content-Type':'application/x-www-form-urlencoded'},"
            "     body:'x=1'});"
            "  await attempt('login', base + '/api/current/login',"
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

        def _reqs(out, suffix, phase):
            return [q for q in bf.requests_log(out)
                    if q["url"].endswith(suffix) and q.get("phase") == phase]

        def _key(entry):
            return tuple(entry.get(k) for k in ("sessionId", "requestId", "redirectHop"))

        def _responses_for(out, requests):
            self.assertTrue(requests, "no requests to correlate")
            indexed = {_key(q): q for q in requests}
            self.assertEqual(len(indexed), len(requests), "duplicate CDP request/hop identity")
            self.assertTrue(all(None not in key for key in indexed), "missing CDP identity")
            responses = [r for r in bf.responses_log(out) if _key(r) in indexed]
            self.assertEqual({_key(r) for r in responses}, set(indexed),
                             "missing exact request-correlated response")
            self.assertEqual(len(responses), len(indexed), "duplicate response/hop identity")
            for response in responses:
                request = indexed[_key(response)]
                for field in ("url", "phase", "method", "origin"):
                    self.assertEqual(response[field], request[field], field)
            return responses

        def _assert_preflight_denied(out, phase):
            current = _reqs(out, "/api/current", phase)
            preflights = [q for q in current
                          if q["method"] == "OPTIONS" and q["origin"] == hostile_origin]
            self.assertTrue(preflights, "no hostile current-API preflight observed")
            responses = _responses_for(out, preflights)
            self.assertTrue(all(r["status"] == 404 for r in responses), responses)
            authenticated_posts = [q for q in current if q["method"] == "POST"
                                   and q.get("hasRequestExtraInfo")
                                   and set(q["cookieNames"]) & set(SESSION_NAMES)]
            self.assertFalse(authenticated_posts, "authenticated JSON POST dispatched despite denied preflight")
            # Do NOT hide an unexpected attack200 because its Origin/command
            # metadata is absent. The phase was snapshotted at request start.
            attack_responses = [r for r in bf.responses_log(out)
                                if r.get("phase") == phase and r["url"].endswith("/api/current")]
            self.assertFalse(any(200 <= r["status"] < 300 for r in attack_responses), attack_responses)

        # -- CLEAN run: hostile JS with OTHERWISE-VALID credentials in a
        # clean context must get wrong-Origin 403 and create NO session.
        # No cookie is dispatched (clean jar), so SameSite cannot suppress:
        # this holds in BOTH sibling and separate modes without planting.
        out_clean = bf.run_steps([
            {"op": "networkPhase", "phase": "hostile-clean"},
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
        _assert_preflight_denied(out_clean, "hostile-clean")
        clean_login_reqs = _reqs(out_clean, "/api/current/login", "hostile-clean")
        self.assertTrue(clean_login_reqs, "no browser login POST dispatched")
        # Complete headers (redacted) + wrong Origin, no cookie in clean jar.
        login_req = [q for q in clean_login_reqs
                     if q["method"] == "POST" and q["origin"] == hostile_origin]
        self.assertTrue(login_req, clean_login_reqs)
        self.assertEqual(login_req[0]["cookieNames"], [], login_req[0])
        self.assertEqual(login_req[0]["headers"].get("Origin"), hostile_origin)
        self.assertIn("application/x-www-form-urlencoded",
                        login_req[0]["headers"].get("Content-Type", ""))
        clean_login_resps = _responses_for(out_clean, login_req)
        self.assertTrue(all(r["status"] == 403 for r in clean_login_resps),
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
            {"op": "networkPhase", "phase": "setup"},
            {"op": "goto", "url": self.api + "/"},
            {"op": "fill", "selector": "[data-account-login] input[name=login]", "value": self.fix.identity.login},
            {"op": "fill", "selector": "[data-account-login] input[name=password]", "value": self.fix.identity.password},
            {"op": "networkPhase", "phase": "victim-login"},
            {"op": "click", "selector": "[data-account-login] button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "loaded"},
            {"op": "networkPhase", "phase": "hostile-auth"},
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
        # Keep legitimate same-URL200s as explicit controls, never as attack
        # evidence. Late response events retain their request's original phase.
        login_controls = [q for q in _reqs(out, "/api/account/v1/login", "victim-login")
                          if q["method"] == "POST" and q["origin"] == self.api]
        login_responses = _responses_for(out, login_controls)
        self.assertTrue(any(r["status"] == 200 for r in login_responses),
                        "canonical password login must succeed as an explicit control")
        self.assertTrue(any(set(r["setCookieNames"]) & set(SESSION_NAMES)
                            for r in login_responses if r["status"] == 200),
                        "canonical login must establish the victim browser session")
        baseline = _reqs(out, "/api/current", "victim-login")
        for command in ("Whoami", "ListArtifacts"):
            controls = [q for q in baseline if q.get("command") == command]
            responses = _responses_for(out, controls)
            self.assertTrue(any(r["status"] == 200 for r in responses), command)
        posts = [q for q in bf.requests_log(out)
                 if q.get("phase") == "hostile-auth" and q["origin"] == hostile_origin
                 and q["method"] == "POST" and "/api/current/" in q["url"]]
        self.assertTrue(any(q["url"].endswith("/api/current/logout") for q in posts),
                        posts)
        # Typed application/json operations cannot be simple cross-origin
        # browser requests. Verify preflight rejection, not an invented 403
        # dispatch proof. Targeted authenticated CreateGrant/Delete 403 checks
        # below still execute over HTTP with the observed live cookie.
        _assert_preflight_denied(out, "hostile-auth")
        logout_req = [q for q in _reqs(out, "/api/current/logout", "hostile-auth")
                      if q["method"] == "POST" and q["origin"] == hostile_origin]
        self.assertTrue(logout_req, posts)
        logout_resps = _responses_for(out, logout_req)
        if self.suffix_mode == "sibling":
            self.assertEqual(logout_req[0]["cookieNames"], ["manure-dev"],
                             logout_req[0])
            self.assertTrue(all(r["status"] == 403 for r in logout_resps),
                            logout_resps)
        else:
            # Separate HTTP: Strict withheld cross-site (SameSite). The CDP
            # helper correctly reports [] (blocked, not sent) and the server
            # answers 401 (unauthenticated), which is NOT an Origin proof.
            self.assertEqual(logout_req[0]["cookieNames"], [], logout_req[0])
            self.assertTrue(all(r["status"] == 401 for r in logout_resps),
                            logout_resps)
        authenticated_login = [q for q in _reqs(out, "/api/current/login", "hostile-auth")
                               if q["method"] == "POST" and q["origin"] == hostile_origin]
        self.assertTrue(authenticated_login, "valid hostile login form was not dispatched")
        for request in authenticated_login + logout_req:
            self.assertIn("application/x-www-form-urlencoded", request["headers"].get("Content-Type", ""))
        self.assertTrue(all(r["status"] == 403 for r in _responses_for(out, authenticated_login)))
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
        who = jar.current((self.api), bf.cp.Command_Whoami())
        self.assertEqual(who.status, 200, who.body[:300])
        evil = {"Origin": "https://evil.example"}
        bad_logout = jar.current((self.api), bf.cp.Command_Logout(), headers=evil)
        self.assertEqual(bad_logout.status, 403, bad_logout.body[:300])
        still = jar.current((self.api), bf.cp.Command_Whoami())
        self.assertEqual(still.status, 200, still.body[:300])
        bad_delete = jar.current((self.api), bf.cp.Command_DeleteArtifact(vid), headers=evil)
        self.assertEqual(bad_delete.status, 403, bad_delete.body[:300])
        # HTTP complements for the browser grants/login proofs above
        # (urllib has no SameSite/preflight/CSP, so separate 403 is direct).
        bad_grants = jar.current((self.api), bf.cp.Command_CreateGrant(vid), headers=evil)
        self.assertEqual(bad_grants.status, 403, bad_grants.body[:300])
        # Otherwise-valid current form routes with a REAL cookie must be403
        # in BOTH modes: urllib deliberately has no SameSite/preflight shield.
        cookie_origin = {"Origin": hostile_origin}
        bad_form_logout = jar.request("POST", self.api + "/api/current/logout", body="",
            content_type="application/x-www-form-urlencoded", headers=cookie_origin)
        self.assertEqual(bad_form_logout.status, 403, bad_form_logout.body[:300])
        self.assertIsNone(bad_form_logout.header("Set-Cookie"))
        bad_form_login = jar.request("POST", self.api + "/api/current/login",
            body=urllib.parse.urlencode({"token": token}),
            content_type="application/x-www-form-urlencoded", headers=cookie_origin)
        self.assertEqual(bad_form_login.status, 403, bad_form_login.body[:300])
        self.assertIsNone(bad_form_login.header("Set-Cookie"))
        still2 = jar.current((self.api), bf.cp.Command_Whoami())
        self.assertEqual(still2.status, 200, still2.body[:300])
        # Valid login with wrong Origin is 403 with NO session (HTTP).
        clean_jar = bf.TestHttp()
        bad_login = clean_jar.request(
            "POST", self.api + "/api/current/login",
            body=urllib.parse.urlencode({"token": token}),
            content_type="application/x-www-form-urlencoded",
            headers=evil)
        self.assertEqual(bad_login.status, 403, bad_login.body[:300])
        self.assertEqual(clean_jar.cookies_for(self.api), {})
        # Meaningful TARGETED state unchanged: victim info + exact bytes.
        intact = self.http.current((self.api), bf.cp.Command_GetArtifact(vid), headers=bearer)
        self.assertEqual(intact.status, 200, intact.body[:300])
        api_content = (f"{self.api}/api/current/artifacts/{vid}/files/"
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
            {"op": "fill", "selector": "[data-account-login] input[name=login]", "value": self.fix.identity.login},
            {"op": "fill", "selector": "[data-account-login] input[name=password]", "value": self.fix.identity.password},
            {"op": "click", "selector": "[data-account-login] button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "loaded"},
            {"op": "click",
             "selector": "button[data-action=open][data-artifact-id=\"" +
                         pub["artifact_id"] + "\"]"},
            {"op": "waitForText", "selector": "h1",
             "contains": "public landing"},
            {"op": "eval", "fn": "() => location.href"},
            {"op": "goto", "url": self.api + "/"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "loaded"},
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
    them). The only native case asserting the product's 410 for a stored
    past expiry, written through the owned database because the API's
    minimum TTL is 60 s; sibling suffix is enough (the flow is
    origin-independent once listed)."""

    @classmethod
    def setUpClass(cls):
        cls.fix = bf.start_server(suffix_mode="sibling")
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
        bf.expire_artifact(self.fix,aid)
        info = self.http.current((self.api), bf.cp.Command_GetArtifact(aid), headers=bearer)
        self.assertEqual(info.status, 410, info.body[:300])
        out = bf.run_steps([
            {"op": "goto", "url": self.api + "/"},
            {"op": "fill", "selector": "[data-account-login] input[name=login]", "value": self.fix.identity.login},
            {"op": "fill", "selector": "[data-account-login] input[name=password]", "value": self.fix.identity.password},
            {"op": "click", "selector": "[data-account-login] button[type=submit]"},
            {"op": "waitForEval", "fn": "() => / loaded|No matches/.test(document.querySelector('#list-status').textContent)"},
            {"op": "fill", "selector": "#filter-text", "value": "expired:true"},
            {"op": "click", "selector": "#search-submit"},
            {"op": "waitForText", "selector": "#artifact-list",
             "contains": aid},
            {"op": "click", "selector": "button[data-action=more][data-artifact-id=\"" + aid + "\"]"},
            {"op": "click",
             "selector": "button[data-action=delete][data-artifact-id=\"" + aid + "\"]"},
            {"op": "click", "selector": "dialog[open] >> role=button[name=\"Delete artifact\"]"},
            {"op": "waitForEval", "fn": "(id) => !document.querySelector(`#artifact-list tr[data-artifact-id=\"${id}\"]`)", "arg": aid},
        ])
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs",
                                                           "requests", "console")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        dialogs = [r for r in out if r.get("op") == "dialogs"][0]["dialogs"]
        self.assertEqual(dialogs, [])
        gone = self.http.current((self.api), bf.cp.Command_GetArtifact(aid), headers=bearer)
        self.assertEqual(gone.status, 404, gone.body[:300])


class DashboardSiblingCase(DashboardFlows, unittest.TestCase):
    suffix_mode = "sibling"


class DashboardSeparateCase(DashboardFlows, unittest.TestCase):
    """B7 must hold on a separate content domain as well."""
    suffix_mode = "separate"


if __name__ == "__main__":
    unittest.main()
