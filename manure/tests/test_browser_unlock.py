"""B3 / B3b: external unlock shell + built-in fallback.

Real Chromium + real manure server. Password entry POSTs urlencoded to
/__manure/unlock on the artifact's own origin (never in URLs); wrong
passwords fail 401 with generic errors and rate-limit; rotation kills
old passwords and grants; unlock_shell_dir=null serves a built-in form
with the same field/target/semantics.
"""

from __future__ import annotations

import os
import sys
import unittest
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import browser_fixtures as bf

INDEX_HTML = b"<!DOCTYPE html><html><body><h1>external site</h1></body></html>"


class UnlockFlows:
    suffix_mode = "sibling"
    unlock_shell = "default"
    config_overrides: dict = {}

    @classmethod
    def setUpClass(cls):
        cls.fix = bf.start_server(suffix_mode=cls.suffix_mode,
                                  unlock_shell=cls.unlock_shell,
                                  config_overrides=dict(cls.config_overrides))
        cls.http = cls.fix.http
        cls.api = cls.fix.api_base

    @classmethod
    def tearDownClass(cls):
        cls.fix.close()

    FORM_SEL = "#unlock-form"
    PW_SEL = "#password-input"
    SUBMIT_SEL = "#unlock-form button[type=submit]"
    native_submit = False

    def _submit_step(self):
        if self.native_submit:
            return {"op": "clickAndReload", "selector": self.SUBMIT_SEL}
        return {"op": "click", "selector": self.SUBMIT_SEL}

    def _external_artifact(self, name="ext-site"):
        created = bf.upload_fixture(
            self.fix, name=name, kind="dir",
            visibility="external", files={"index.html": INDEX_HTML})
        password = created.get("external_password")
        self.assertTrue(password, "init did not return an external password")
        content_url = bf.content_url_for(self.fix, created["artifact_id"])
        return created["artifact_id"], password, content_url

    def test_b3_unlock_shell_round_trip_in_browser(self):
        aid, password, content_url = self._external_artifact()
        origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(content_url))
        out = bf.run_steps([
            {"op": "goto", "url": content_url},
            {"op": "count", "selector": self.FORM_SEL},
            {"op": "attr", "selector": self.FORM_SEL, "name": "action"},
            {"op": "attr", "selector": self.FORM_SEL, "name": "method"},
            {"op": "fill", "selector": self.PW_SEL, "value": password},
            self._submit_step(),
            {"op": "waitForText", "selector": "h1",
             "contains": "external site"},
            {"op": "text", "selector": "h1"},
            {"op": "eval", "fn": "() => location.href"},
            {"op": "eval", "fn": "() => document.cookie"},
            {"op": "cookies", "urls": [origin]},
        ])
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        counts = [r for r in out if r.get("op") == "count"]
        self.assertEqual(counts[0]["count"], 1, "unlock form not rendered")
        attrs = [r for r in out if r.get("op") == "attr"]
        self.assertIn("/__manure/unlock", attrs[0]["value"] or "")
        self.assertEqual((attrs[1]["value"] or "").lower(), "post")
        texts = [r for r in out if r.get("op") == "text"]
        self.assertIn("external site", texts[0]["text"] or "")
        evals = [r for r in out if r.get("op") == "eval"]
        self.assertNotIn(password, evals[0]["value"], "password leaked into URL")
        self.assertEqual(evals[1]["value"], "", "grant cookie readable from JS")
        cookies = [r for r in out if r.get("op") == "cookies"][0]["cookies"]
        grants = [c for c in cookies
                  if c["name"] in ("__Host-mgrant", "mgrant-dev")]
        self.assertEqual(len(grants), 1, cookies)
        self.assertTrue(grants[0]["httpOnly"], grants[0])
        # No request URL anywhere in the flow carries the password.
        bf.assert_no_secrets_in_request_urls(self, out, [password])

    def test_b3_wrong_password_fails_generic_without_cookie(self):
        aid, password, content_url = self._external_artifact(name="ext-wrong")
        wrong = bf.canonical_secret()
        self.assertNotEqual(wrong, password)
        unlock = content_url.rstrip("/") + "/__manure/unlock"
        origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(content_url))
        # Browser: wrong password leaves the artifact locked, shows a
        # generic (repo shell) or re-rendered (built-in) failure, and
        # sets no grant cookie in either case.
        if self.native_submit:
            browser_steps = [
                {"op": "goto", "url": content_url},
                {"op": "fill", "selector": self.PW_SEL, "value": wrong},
                self._submit_step(),
                {"op": "count", "selector": self.FORM_SEL},
                {"op": "eval", "fn": "() => location.href"},
                {"op": "cookies", "urls": [origin]},
            ]
        else:
            browser_steps = [
                {"op": "goto", "url": content_url},
                {"op": "fill", "selector": self.PW_SEL, "value": wrong},
                self._submit_step(),
                {"op": "waitForText", "selector": "#unlock-error",
                 "contains": "Unlock failed"},
                {"op": "text", "selector": "#unlock-error"},
                {"op": "eval", "fn": "() => location.href"},
                {"op": "cookies", "urls": [origin]},
            ]
        out = bf.run_steps(browser_steps)
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        if self.native_submit:
            forms = [r for r in out if r.get("op") == "count"][0]["count"]
            self.assertGreaterEqual(forms, 1, "unlock form gone after failure")
        else:
            err = ([r for r in out if r.get("op") == "text"][0]["text"] or "")
            self.assertTrue(err, "no generic error shown")
            self.assertNotIn(wrong, err, "error echoes the password")
        href = [r for r in out if r.get("op") == "eval"][0]["value"]
        self.assertNotIn(wrong, href, "password leaked into URL")
        if not self.native_submit:
            # No navigation happened: the shell JS intercepted the submit
            # (proves /unlock.js loaded and ran, R3).
            self.assertEqual(href.rstrip("/"), content_url)
        cookies = [r for r in out if r.get("op") == "cookies"][0]["cookies"]
        self.assertFalse([c for c in cookies
                          if c["name"] in ("__Host-mgrant", "mgrant-dev")],
                         "grant cookie set on failure")
        # HTTP shapes: JSON failure is a password-invalid envelope.
        jar = bf.TestHttp()
        bad = jar.request("POST", unlock, body={"password": wrong},
                          content_type="application/json",
                          headers={"Origin": origin})
        self.assertEqual(bad.status, 401, bad.body[:300])
        self.assertEqual(bad.json()["error"]["code"], "password-invalid")
        self.assertNotIn(password, bad.body.decode(), "real password in fault")
        # Urlencoded failure is the same class over HTTP.
        form = {"password": wrong}
        body = urllib.parse.urlencode(form)
        bad_form = bf.TestHttp().request(
            "POST", unlock, body=body,
            content_type="application/x-www-form-urlencoded",
            headers={"Origin": origin})
        self.assertEqual(bad_form.status, 401, bad_form.body[:300])

    def test_b3_rotation_kills_old_password_and_grants(self):
        aid, password, content_url = self._external_artifact(name="ext-rotate")
        origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(content_url))
        unlock = content_url.rstrip("/") + "/__manure/unlock"
        bearer = {"Authorization": f"Bearer {self.fix.identity.token}"}
        # Unlock with the first password: a grant cookie is issued.
        jar = bf.TestHttp()
        first = jar.request(
            "POST", unlock,
            body=urllib.parse.urlencode({"password": password}),
            content_type="application/x-www-form-urlencoded",
            headers={"Origin": origin})
        self.assertIn(first.status, (200, 303), first.body[:300])
        self.assertTrue(jar.cookies_for(content_url), "no grant cookie issued")
        # Rotate: a fresh password is returned exactly once.
        rot = self.http.request(
            "POST", f"{self.api}/api/v1/artifacts/{aid}/external-password:rotate",
            body={}, headers=bearer)
        self.assertEqual(rot.status, 200, rot.body[:300])
        second = rot.json()["external_password"]
        self.assertEqual(len(second), 43)
        self.assertNotEqual(second, password)
        # Old password is dead.
        stale = bf.TestHttp().request(
            "POST", unlock, body={"password": password},
            content_type="application/json", headers={"Origin": origin})
        self.assertEqual(stale.status, 401, stale.body[:300])
        # Old grant cookie is dead: the content host falls back to the
        # password form (200 with the unlock page, per contract) and the
        # authorized manifest endpoint refuses the stale cookie.
        gone = jar.request("GET", content_url + "/")
        self.assertEqual(gone.status, 200, gone.body[:300])
        self.assertNotIn(b"external site", gone.body)
        self.assertIn(b"/__manure/unlock", gone.body)
        manifest = jar.request("GET", content_url.rstrip("/") + "/__manure/manifest")
        self.assertNotEqual(manifest.status, 200, manifest.body[:300])
        # New password works.
        fresh = bf.TestHttp().request(
            "POST", unlock, body={"password": second},
            content_type="application/json", headers={"Origin": origin})
        self.assertEqual(fresh.status, 200, fresh.body[:300])

    def test_b3_logout_clears_grant_cookie(self):
        aid, password, content_url = self._external_artifact(name="ext-logout")
        origin = "{0.scheme}://{0.netloc}".format(
            urllib.parse.urlsplit(content_url))
        unlock = content_url.rstrip("/") + "/__manure/unlock"
        jar = bf.TestHttp()
        ok = jar.request(
            "POST", unlock,
            body=urllib.parse.urlencode({"password": password}),
            content_type="application/x-www-form-urlencoded",
            headers={"Origin": origin})
        self.assertIn(ok.status, (200, 303), ok.body[:300])
        self.assertTrue(jar.cookies_for(content_url))
        out = jar.request(
            "POST", content_url.rstrip("/") + "/__manure/logout",
            body="", content_type="application/x-www-form-urlencoded",
            headers={"Origin": origin})
        self.assertIn(out.status, (200, 303), out.body[:300])
        # After logout the grant is gone server-side: the unlock page is
        # served again and the authorized manifest refuses the cookie.
        denied = jar.request("GET", content_url + "/")
        self.assertEqual(denied.status, 200, denied.body[:300])
        self.assertNotIn(b"external site", denied.body)
        manifest = jar.request("GET", content_url.rstrip("/") + "/__manure/manifest")
        self.assertNotEqual(manifest.status, 200, manifest.body[:300])

    def test_b3_unlock_assets_served_locked_else_404(self):
        # R3/F2: trusted sibling assets serve while locked; unknown
        # paths are 404 JSON, never the password form. In built-in
        # fallback mode (no shell dir) there is nothing to serve, so
        # even the asset names 404 — also never the form.
        aid, _, content_url = self._external_artifact(name="ext-assets")
        anon = bf.TestHttp()
        base = content_url.rstrip("/")
        if self.unlock_shell is None:
            for path in ("/unlock.js", "/styles.css", "/nope.js"):
                res = anon.request("GET", base + path)
                self.assertEqual(res.status, 404, (path, res.status))
                self.assertNotIn(b"unlock-form", res.body)
            return
        for name, marker in (("unlock.js", "addEventListener"),
                             ("styles.css", "font-family")):
            res = anon.request("GET", base + "/" + name)
            self.assertEqual(res.status, 200, (name, res.status))
            with open(os.path.join(bf.UNLOCK_DIR, name), "rb") as fh:
                self.assertEqual(res.body, fh.read(), name)
            self.assertIn(marker, res.body.decode(), name)
        ctype = anon.request("GET", base + "/unlock.js").header("Content-Type") or ""
        self.assertIn("javascript", ctype, ctype)
        missing = anon.request("GET", base + "/nope.js")
        self.assertEqual(missing.status, 404, missing.body[:200])
        self.assertNotIn(b"unlock-form", missing.body)

    def test_b3_password_pages_use_origin_only_referrer_policy(self):
        # Same codified exception as the dashboard shell: server-generated
        # unlock pages submit a navigational form, so they must carry
        # strict-origin (reproduced D2: no-referrer makes Chromium send
        # Origin:null, failing the exact-Origin unlock check).
        aid, _, content_url = self._external_artifact(name="ext-referrer")
        anon = bf.TestHttp()
        for path in ("/", "/__manure/password"):
            res = anon.request("GET", content_url.rstrip("/") + path)
            self.assertEqual(res.status, 200, (path, res.status))
            self.assertEqual(res.header("Referrer-Policy"), "strict-origin",
                             (path, res.headers))

    def test_b3_browser_revocation_and_password_rotation(self):
        """Rotation in one browser session: unlock, rotate out-of-band,
        replay the exact pre-rotation cookie (now dead), prove the old
        password fails and the fresh password opens."""
        aid, password, content_url = self._external_artifact(name="ext-brotate")
        origin = "{0.scheme}://{0.netloc}".format(
            urllib.parse.urlsplit(content_url))
        bearer = {"Authorization": f"Bearer {self.fix.identity.token}"}
        out = bf.run_steps([
            {"op": "goto", "url": content_url},
            {"op": "fill", "selector": self.PW_SEL, "value": password},
            self._submit_step(),
            {"op": "waitForText", "selector": "h1",
             "contains": "external site"},
            {"op": "cookies", "urls": [origin]},
        ])
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs",
                                                           "requests", "console")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        cookies = [r for r in out if r.get("op") == "cookies"][0]["cookies"]
        grants = [c for c in cookies
                  if c["name"] in ("__Host-mgrant", "mgrant-dev")]
        self.assertEqual(len(grants), 1, cookies)
        rot = self.http.request(
            "POST", f"{self.api}/api/v1/artifacts/{aid}/external-password:rotate",
            body={}, headers=bearer)
        self.assertEqual(rot.status, 200, rot.body[:300])
        fresh = rot.json()["external_password"]
        self.assertNotEqual(fresh, password)
        replay = [{"url": origin, "name": grants[0]["name"],
                   "value": grants[0]["value"]}]
        if self.native_submit:
            flow = [
                {"op": "setCookies", "cookies": replay},
                {"op": "goto", "url": content_url},
                {"op": "count", "selector": self.FORM_SEL},
                {"op": "fill", "selector": self.PW_SEL, "value": password},
                self._submit_step(),
                {"op": "count", "selector": self.FORM_SEL},
                {"op": "fill", "selector": self.PW_SEL, "value": fresh},
                self._submit_step(),
                {"op": "waitForText", "selector": "h1",
                 "contains": "external site"},
            ]
        else:
            flow = [
                {"op": "setCookies", "cookies": replay},
                {"op": "goto", "url": content_url},
                {"op": "waitForText", "selector": "h1",
                 "contains": "Protected artifact"},
                {"op": "fill", "selector": self.PW_SEL, "value": password},
                self._submit_step(),
                {"op": "waitForText", "selector": "#unlock-error",
                 "contains": "Unlock failed"},
                {"op": "fill", "selector": self.PW_SEL, "value": fresh},
                self._submit_step(),
                {"op": "waitForText", "selector": "h1",
                 "contains": "external site"},
            ]
        out2 = bf.run_steps(flow)
        results2 = [r for r in out2 if r.get("op") not in ("pageerrors", "dialogs",
                                                           "requests", "console")]
        self.assertTrue(all(r.get("ok") for r in results2),
                        [r for r in results2 if not r.get("ok")])
        if self.native_submit:
            counts = [r for r in out2 if r.get("op") == "count"]
            self.assertEqual(counts[0]["count"], 1, "revoked cookie still opens")
            self.assertEqual(counts[1]["count"], 1, "old password opened post-rotate")

    def test_b3_no_password_appears_in_listings_or_manifest(self):
        aid, password, _ = self._external_artifact(name="ext-leak")
        bearer = {"Authorization": f"Bearer {self.fix.identity.token}"}
        listing = self.http.request("GET", self.api + "/api/v1/artifacts?limit=50",
                                    headers=bearer)
        self.assertEqual(listing.status, 200, listing.body[:300])
        self.assertNotIn(password, listing.body.decode())
        info = self.http.request("GET", f"{self.api}/api/v1/artifacts/{aid}",
                                 headers=bearer)
        self.assertNotIn(password, info.body.decode())
        files = self.http.request(
            "GET", f"{self.api}/api/v1/artifacts/{aid}/files", headers=bearer)
        self.assertNotIn(password, files.body.decode())


class UnlockSiblingCase(UnlockFlows, unittest.TestCase):
    suffix_mode = "sibling"


class UnlockSeparateCase(UnlockFlows, unittest.TestCase):
    suffix_mode = "separate"


class UnlockBuiltinSiblingCase(UnlockFlows, unittest.TestCase):
    """B3b: unlock_shell_dir=null falls back to the built-in form."""
    suffix_mode = "sibling"
    unlock_shell = None
    FORM_SEL = 'form[action="/__manure/unlock"]'
    PW_SEL = 'form[action="/__manure/unlock"] input[name="password"]'
    SUBMIT_SEL = ('form[action="/__manure/unlock"] button[type="submit"],'
                  'form[action="/__manure/unlock"] input[type="submit"]')
    native_submit = True


class UnlockRateLimitCase(UnlockFlows, unittest.TestCase):
    """Wrong-password flood must 429 with Retry-After (tiny test limit)."""
    suffix_mode = "sibling"
    # ASSUMED_CONFIG_FIELD: unlock_rate_per_min per contract 3.1.
    config_overrides = {"unlock_rate_per_min": 3}

    def test_b3_browser_rate_limit_statuses(self):
        """Wrong-password flood from live page JS: same-origin fetch
        posts are readable, so the 429 + Retry-After is observed in the
        browser, not just over HTTP."""
        _, _, content_url = self._external_artifact(name="ext-bratelimit")
        wrong = bf.canonical_secret()
        out = bf.run_steps([
            {"op": "goto", "url": content_url},
            {"op": "eval",
             "fn": "(pw) => (async () => {"
                    " const out = [];"
                    " for (let i = 0; i < 6; i++) {"
                    "   const r = await fetch('/__manure/unlock',"
                    "     {method:'POST', credentials:'same-origin',"
                    "      headers:{'Content-Type':'application/json'},"
                    "      body: JSON.stringify({password: pw})});"
                    "   out.push(r.status + ':' + (r.headers.get('retry-after') || '-'));"
                    " }"
                    " return out.join(','); })()",
             "arg": wrong},
        ])
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs",
                                                           "requests", "console")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        seen = [r for r in out if r.get("op") == "eval"][0]["value"]
        statuses = [part.split(":")[0] for part in seen.split(",")]
        self.assertIn("429", statuses, seen)
        retry = [part.split(":")[1] for part in seen.split(",")
                 if part.startswith("429:")]
        self.assertTrue(retry and all(v != "-" for v in retry), seen)

    def test_b3_unlock_rate_limited_with_retry_after(self):
        aid, password, content_url = self._external_artifact(name="ext-ratelimit")
        unlock = content_url.rstrip("/") + "/__manure/unlock"
        origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(content_url))
        statuses = []
        last: bf.HttpResult | None = None
        wrong = bf.canonical_secret()
        for _ in range(8):
            last = bf.TestHttp().request(
                "POST", unlock, body={"password": wrong},
                content_type="application/json",
                headers={"Origin": origin})
            statuses.append(last.status)
        self.assertIn(429, statuses, statuses)
        assert last is not None
        limited = [s for s in statuses if s == 429]
        self.assertTrue(limited)
        retry = last.header("Retry-After")
        self.assertTrue(retry, "429 without Retry-After")


if __name__ == "__main__":
    unittest.main()
