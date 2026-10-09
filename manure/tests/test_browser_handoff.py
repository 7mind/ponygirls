"""B2: internal one-time grant handoff, sibling AND separate suffix modes.

Real Chromium + real manure server. The dashboard must POST a one-time
grant and top-level form-POST it (urlencoded) to the artifact's own
content host, which answers 303; the long-term credential never reaches
the content origin and the grant is single-use.
"""

from __future__ import annotations

import os
import sys
import unittest
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import browser_fixtures as bf

INDEX_HTML = ("<!DOCTYPE html><html><head><meta charset=utf-8>"
              "<title>HANDOFF-PLACEHOLDER</title></head>"
              "<body><h1>internal site</h1>"
              "<script>document.title='HANDOFF-OK:'+location.host</script>"
              "</body></html>")


class HandoffFlows:
    suffix_mode = "sibling"

    @classmethod
    def setUpClass(cls):
        cls.fix = bf.start_server(suffix_mode=cls.suffix_mode)
        cls.http = cls.fix.http
        cls.api = cls.fix.api_base

    @classmethod
    def tearDownClass(cls):
        cls.fix.close()

    def test_b2_dashboard_open_hands_off_to_content_origin(self):
        created = bf.upload_fixture(
            self.fix, name="handoff-site", kind="dir",
            visibility="internal", files={"index.html": INDEX_HTML.encode()})
        aid = created["artifact_id"]
        content_url = bf.content_url_for(self.fix, aid)
        content_origin = "{0.scheme}://{0.netloc}".format(
            urllib.parse.urlsplit(content_url))
        token = self.fix.identity.token
        out = bf.run_steps([
            {"op": "goto", "url": self.api + "/"},
            {"op": "fill", "selector": "#token-input", "value": token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status",
             "contains": "shown"},
            # Plain click (no waitForUrl: localhost navigations can settle
            # before a waiter attaches; the title poll below proves the
            # landing without any race).
            {"op": "click",
             "selector": "button[data-action=open][data-artifact-id=\"" + aid + "\"]"},
            {"op": "waitForEval",
             "fn": "() => document.title.indexOf('HANDOFF-OK:') === 0"},
            # Uploaded JS runs under the artifact origin: it sees its own
            # host but must not see any long-term credential material.
            {"op": "eval", "fn": "() => document.title"},
            {"op": "eval", "fn": "() => document.cookie"},
            {"op": "eval", "fn": "() => [Object.keys(window.localStorage).length,"
                                 " Object.keys(window.sessionStorage).length].join(',')"},
            {"op": "eval", "fn": "() => location.href"},
            {"op": "cookies", "urls": [content_origin, self.api + "/"]},
        ])
        results = [r for r in out if r.get("op") not in ("pageerrors", "dialogs")]
        self.assertTrue(all(r.get("ok") for r in results),
                        [r for r in results if not r.get("ok")])
        # op "eval" results in step order: title, cookie, storage,
        # href. (click and waitForUrl/waitForEval report under own ops.)
        evals = [r for r in out if r.get("op") == "eval"]
        self.assertTrue(evals[0]["value"].startswith("HANDOFF-OK:"),
                        evals[0])
        self.assertIn(aid, evals[0]["value"], "not on the artifact's own host")
        self.assertEqual(evals[1]["value"], "",
                         "page JS can read a cookie (HttpOnly violated?)")
        self.assertEqual(evals[2]["value"], "0,0", "page uses web storage")
        # No secret material in the navigated-to URL, nor in any request
        # URL observed during the flow.
        self.assertNotIn("grant", evals[3]["value"])
        self.assertNotIn(token, evals[3]["value"])
        bf.assert_no_secrets_in_request_urls(self, out, [token])
        cookies = [r for r in out if r.get("op") == "cookies"][0]["cookies"]
        by_url: dict[str, list] = {}
        for c in cookies:
            by_url.setdefault(c["url"], []).append(c)
        grants = [c for c in by_url.get(content_origin, [])
                  if c["name"] in ("__Host-mgrant", "mgrant-dev")]
        self.assertEqual(len(grants), 1, cookies)
        grant = grants[0]
        self.assertTrue(grant["httpOnly"], grant)
        self.assertEqual((grant["sameSite"] or "").lower(), "lax", grant)
        self.assertEqual(grant["domain"],
                         urllib.parse.urlsplit(content_url).hostname, grant)
        # The dashboard session cookie is scoped to the API origin only.
        api_cookies = {c["name"] for c in by_url.get(self.api + "/", [])}
        content_names = {c["name"] for c in by_url.get(content_origin, [])}
        self.assertTrue({"__Host-manure", "manure-dev"} & api_cookies, api_cookies)
        self.assertFalse({"__Host-manure", "manure-dev"} & content_names,
                         "session cookie leaked to content origin")

    def test_b2_one_time_grant_cannot_be_reused(self):
        created = bf.upload_fixture(
            self.fix, name="grant-once", kind="dir",
            visibility="internal", files={"index.html": b"<h1>once</h1>"})
        aid = created["artifact_id"]
        content_url = bf.content_url_for(self.fix, aid)
        grant_url = content_url.rstrip("/") + "/__manure/grant"
        bearer = {"Authorization": f"Bearer {self.fix.identity.token}"}
        first = self.http.request(
            "POST", f"{self.api}/api/v1/artifacts/{aid}/grants", body={},
            headers=bearer)
        self.assertEqual(first.status, 200, first.body[:300])
        grant = first.json()["grant"]
        user = bf.TestHttp()
        ok = user.request(
            "POST", grant_url, body={"grant": grant},
            content_type="application/json",
            headers={"Origin": self.api})
        self.assertIn(ok.status, (200, 303), ok.body[:300])
        # Single-use: the same grant is now dead.
        again = bf.TestHttp()
        reuse = again.request(
            "POST", grant_url, body={"grant": grant},
            content_type="application/json",
            headers={"Origin": self.api})
        self.assertIn(reuse.status, (401, 403), reuse.body[:300])
        self.assertIn(reuse.json()["error"]["code"],
                      ("grant-invalid", "grant-expired"),
                      reuse.body[:300])
        # Wrong-origin grant POSTs are rejected even with a fresh grant.
        second = self.http.request(
            "POST", f"{self.api}/api/v1/artifacts/{aid}/grants", body={},
            headers=bearer)
        cross = bf.TestHttp()
        cross_res = cross.request(
            "POST", grant_url, body={"grant": second.json()["grant"]},
            content_type="application/json",
            headers={"Origin": "https://evil.example"})
        self.assertEqual(cross_res.status, 403, cross_res.body[:300])


class HandoffSiblingCase(HandoffFlows, unittest.TestCase):
    suffix_mode = "sibling"


class HandoffSeparateCase(HandoffFlows, unittest.TestCase):
    suffix_mode = "separate"


if __name__ == "__main__":
    unittest.main()
