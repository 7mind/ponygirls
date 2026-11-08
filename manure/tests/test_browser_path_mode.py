"""LOW-SECURITY path mode: real Chromium handoff/unlock and mounted-site URLs."""
import json
import os
from pathlib import Path
import unittest

import browser_fixtures as bf

INDEX = b'''<!doctype html><title>loading</title><link rel="stylesheet" href="assets/site.css">
<h1 id="site">mounted content</h1><script src="assets/site.js"></script>'''
FILES = {'index.html': INDEX, 'assets/site.js': b'document.title="PATH-OK";',
         'assets/site.css': b'h1 {color: rgb(1, 2, 3)}',
         'nested/index.html': b'<!doctype html><title>NESTED-OK</title><script src="../assets/site.js"></script><h1 id="site">nested content</h1>'}


class PathBrowserCase(unittest.TestCase):
    def checked(self, steps):
        out = bf.run_steps(steps)
        self.assertTrue(all(x['ok'] for x in out), [x for x in out if not x['ok']])
        return out

    def test_internal_handoff_two_grants_and_nested_relative_assets(self):
        viewer_dir = os.environ.get('MANURE_TEST_VIEWER_DIR', str(Path(__file__).resolve().parents[1] / 'web/viewer/dist'))
        fix = bf.start_server(suffix_mode='path', config_overrides={'viewer_dir': viewer_dir})
        self.addCleanup(fix.close)
        a, b = [bf.upload_fixture(fix, name='path-' + n, kind='dir', visibility='internal', files=FILES) for n in ('a', 'b')]
        direct = bf.upload_fixture(fix, name='path-bookmark', kind='dir', visibility='internal', files=FILES)
        steps = [
            # No session: retry exactly once, then a stable explicit sign-in.
            {'op': 'goto', 'url': direct['content_url'] + '/nested/?discard=1'},
            {'op': 'waitForEval', 'fn': '() => location.search === "?manure-continue=1" && !document.querySelector("meta[http-equiv=refresh]") && document.body.textContent.includes("Sign in to open")'},
            {'op': 'reload'},
            {'op': 'waitForEval', 'fn': '() => !document.querySelector("meta[http-equiv=refresh]") && document.querySelector("a").getAttribute("href") === ' + json.dumps('/#/artifact/' + direct['artifact_id'])},
            {'op': 'goto', 'url': fix.api_base + '/'},
            {'op': 'fill', 'selector': '#token-input', 'value': fix.identity.token},
            {'op': 'click', 'selector': '#login-form button[type=submit]'},
            {'op': 'waitForText', 'selector': '#list-status', 'contains': 'shown'},
        ]
        # Regression (blackbox/controlled Chromium + server): Strict management
        # cookies are withheld on a real anchor click from a different site.
        # Each target is fresh: no scoped content grant can mask the defect.
        cross_site_targets = []
        for suffix in ('/', '/nested/', '/__manure/view/nested/note.md'):
            fixture_files = dict(FILES, **{'nested/note.md': b'# Cross-site viewer'})
            item = bf.upload_fixture(fix, name='cross-site-' + suffix, kind='dir', visibility='internal', files=fixture_files)
            target = item['content_url'] + suffix
            cross_site_targets.append(target)
            if suffix == '/nested/':
                # A legitimately issued, then server-revoked content cookie must
                # not prevent rechecking the still-valid management session.
                user = bf.TestHttp()
                issued = fix.http.current(fix.api_base, bf.cp.Command_CreateGrant(item['artifact_id']),
                                          headers={'Authorization': 'Bearer ' + fix.identity.token})
                self.assertEqual(issued.status, 200)
                redeemed = user.current(item['content_url'], bf.cp.ContentCommand_RedeemGrant(issued.json()['grant']),
                                        headers={'Origin': fix.api_base})
                self.assertEqual(redeemed.status, 200)
                stale = redeemed.headers.get('Set-Cookie').split(';', 1)[0]
                revoked = user.current(item['content_url'], bf.cp.ContentCommand_Logout(), headers={'Origin': fix.api_base})
                self.assertEqual(revoked.status, 200)
                name, value = stale.split('=', 1)
                steps.append({'op': 'setCookies', 'cookies': [{'name': name, 'value': value,
                    'domain': '127.0.0.1', 'path': '/view/' + item['artifact_id'] + '/',
                    'sameSite': 'Lax', 'httpOnly': True}]})
            steps.extend([
                {'op': 'goto', 'url': fix.api_base.replace('127.0.0.1', 'localhost') + '/'},
                {'op': 'eval', 'fn': 'url => { const a = document.createElement("a"); a.id = "cross-site-link"; a.href = url; a.textContent = "Open"; document.body.appendChild(a); return location.origin; }', 'arg': target},
                {'op': 'click', 'selector': '#cross-site-link'},
                {'op': 'waitForEval', 'fn': '() => location.pathname === ' + json.dumps('/view/' + item['artifact_id'] + suffix) + ' && ' + ('document.body.textContent.includes("Cross-site viewer")' if '/__manure/view/' in suffix else 'document.title === "PATH-OK"')},
                {'op': 'cookies', 'urls': [target]},
            ])
        steps.extend([
            {'op': 'goto', 'url': direct['content_url'] + '/nested/'},
            {'op': 'waitForEval', 'fn': '() => document.title === "PATH-OK" && location.pathname.endsWith("/nested/")'},
            {'op': 'goto', 'url': fix.api_base + '/'},
            {'op': 'waitForText', 'selector': '#list-status', 'contains': 'shown'},
        ])
        for item in (a, b):
            steps.extend([
                {'op': 'click', 'selector': 'button[data-action=open][data-artifact-id="' + item['artifact_id'] + '"]'},
                {'op': 'waitForEval', 'fn': '() => document.title === "PATH-OK"'},
                {'op': 'waitForEval', 'fn': '() => getComputedStyle(document.querySelector("h1")).color === "rgb(1, 2, 3)"'},
                {'op': 'goto', 'url': fix.api_base + '/'},
                {'op': 'waitForText', 'selector': '#list-status', 'contains': 'shown'},
            ])
        steps.extend([
            {'op': 'goto', 'url': a['content_url'] + '/nested'},
            {'op': 'waitForEval', 'fn': '() => document.title === "PATH-OK" && location.pathname.endsWith("/nested/")'},
            {'op': 'cookies', 'urls': [a['content_url'] + '/', b['content_url'] + '/']},
        ])
        out = self.checked(steps)
        cookies = [x['cookies'] for x in out if x['op'] == 'cookies'][-1]
        session = next(c for c in cookies if c['name'] == 'manure-dev')
        self.assertEqual(session['sameSite'], 'Strict')
        requests = next(x['requests'] for x in out if x['op'] == 'requests')
        for target in cross_site_targets:
            first = next(r for r in requests if r['url'] == target)
            self.assertNotIn('manure-dev', first['cookieNames'])
            artifact_id = target.split('/view/', 1)[1].split('/', 1)[0]
            if target.endswith('/nested/'):
                self.assertIn('mgrant-dev-' + artifact_id, first['cookieNames'])
            else:
                self.assertNotIn('mgrant-dev-' + artifact_id, first['cookieNames'])
            resumed = next(r for r in requests if r['url'] == target + '?manure-continue=1')
            self.assertIn('manure-dev', resumed['cookieNames'])
        for item in (a, b):
            aid = item['artifact_id']
            grant = next(c for c in cookies if c['name'] == 'mgrant-dev-' + aid)
            self.assertEqual(grant['path'], '/view/' + aid + '/')
            self.assertTrue(grant['httpOnly'])
        bf.assert_no_secrets_in_request_urls(self, out, [fix.identity.token])

    def test_external_packaged_and_builtin_password_forms(self):
        for shell in ('default', None):
            with self.subTest(shell=shell):
                fix = bf.start_server(suffix_mode='path', unlock_shell=shell)
                try:
                    item = bf.upload_fixture(fix, name='external-path', kind='dir', visibility='external', files=FILES)
                    # Password control page and the regular entry point both use the mount prefix.
                    url = item['content_url']
                    out = self.checked([
                        {'op': 'goto', 'url': url + '/__manure/password'},
                        {'op': 'eval', 'fn': '() => document.querySelector("form").action'},
                        {'op': 'fill', 'selector': 'input[name=password]', 'value': item['external_password']},
                        {'op': 'click', 'selector': 'button[type=submit]'},
                        {'op': 'waitForEval', 'fn': '() => document.title === "PATH-OK"'},
                        {'op': 'waitForEval', 'fn': '() => getComputedStyle(document.querySelector("h1")).color === "rgb(1, 2, 3)"'},
                        {'op': 'goto', 'url': url + '/nested'},
                        {'op': 'waitForEval', 'fn': '() => document.title === "PATH-OK" && location.pathname.endsWith("/nested/")'},
                    ])
                    action = next(x['value'] for x in out if x['op'] == 'eval')
                    self.assertEqual(action, url + '/__manure/unlock')
                    bf.assert_no_secrets_in_request_urls(self, out, [item['external_password']])
                finally:
                    fix.close()

    def test_public_canonical_mount_and_relative_assets(self):
        fix = bf.start_server(suffix_mode='path')
        self.addCleanup(fix.close)
        item = bf.upload_fixture(fix, name='public-path', kind='dir', visibility='public', files=FILES)
        self.checked([
            {'op': 'goto', 'url': item['content_url']},
            {'op': 'waitForEval', 'fn': '() => document.title === "PATH-OK" && location.pathname.endsWith("/")'},
            {'op': 'waitForEval', 'fn': '() => getComputedStyle(document.querySelector("h1")).color === "rgb(1, 2, 3)"'},
        ])


class PathTlsBrowserCase(unittest.TestCase):
    def test_secure_internal_handoff_external_unlock_and_cookie_binding(self):
        fix = bf.start_https_server(config_overrides={'content_mode': 'path', 'content_suffix': ''})
        self.addCleanup(fix.close)
        internal = bf.upload_fixture(fix, name='tls-path-internal', kind='dir', visibility='internal', files=FILES)
        external = bf.upload_fixture(fix, name='tls-path-external', kind='dir', visibility='external', files=FILES)
        out = bf.run_steps([
            {'op': 'goto', 'url': fix.api_base + '/'},
            {'op': 'waitForEval', 'fn': '() => { const icon = document.getElementById("path-mode-warning"); return !icon.hidden && icon.tagName === "SPAN" && icon.getAttribute("role") === "img" && icon.title.includes("share") && icon.textContent === "ⓘ"; }'},
            # Regression: public hosting safety must survive the unauthenticated
            # session check and be visible outside the hidden workspace shell.
            {'op': 'waitForEval', 'fn': '() => { const icon = document.getElementById("path-mode-warning"); const rect = icon.getBoundingClientRect(); return !document.getElementById("login-section").hidden && !icon.hidden && rect.width > 0 && rect.width <= 24 && rect.height > 0 && rect.height <= 24; }'},
            {'op': 'fill', 'selector': '#token-input', 'value': fix.identity.token},
            {'op': 'click', 'selector': '#login-form button[type=submit]'},
            {'op': 'waitForText', 'selector': '#list-status', 'contains': 'shown'},
            {'op': 'waitForEval', 'fn': '() => { const rect = document.getElementById("path-mode-warning").getBoundingClientRect(); return rect.width > 0 && rect.width <= 24 && rect.height > 0 && rect.height <= 24; }'},
            # A bookmarked content URL must exchange the existing dashboard session
            # for its own scoped grant, without first clicking dashboard Open.
            {'op': 'goto', 'url': internal['content_url']},
            {'op': 'waitForEval', 'fn': '() => document.title === "PATH-OK"'},
            # This observed shared-session access is the reason path mode is LOW-SECURITY.
            {'op': 'eval', 'fn': 'async () => (await (await fetch("/api/current", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:crypto.randomUUID(),apiVersion:"1.0.0",command:{Whoami:{}}})})).json()).result.Identity.principal.userId'},
            {'op': 'goto', 'url': external['content_url']},
            {'op': 'waitForEval', 'fn': '() => { const icon = document.getElementById("path-mode-warning"); const rect = icon.getBoundingClientRect(); return icon.getAttribute("role") === "img" && icon.title.includes("share") && icon.textContent === "ⓘ" && rect.width > 0 && rect.width <= 24 && rect.height > 0 && rect.height <= 24; }'},
            {'op': 'fill', 'selector': 'input[name=password]', 'value': external['external_password']},
            {'op': 'click', 'selector': 'button[type=submit]'},
            {'op': 'waitForEval', 'fn': '() => document.title === "PATH-OK"'},
            {'op': 'cookies', 'urls': [internal['content_url'] + '/', external['content_url'] + '/']},
        ], ignore_https_errors=True, host_resolver_rules=bf.TLS_RESOLVER_RULES)
        self.assertTrue(all(x['ok'] for x in out), [x for x in out if not x['ok']])
        self.assertEqual(next(x['value'] for x in out if x['op'] == 'eval'), fix.identity.user_id)
        cookies = [x['cookies'] for x in out if x['op'] == 'cookies'][-1]
        for item in (internal, external):
            aid = item['artifact_id']
            grant = next(c for c in cookies if c['name'] == '__Secure-mgrant-' + aid)
            self.assertTrue(grant['secure'])
            self.assertTrue(grant['httpOnly'])
            self.assertEqual(grant['domain'], bf.TLS_API_HOST)
            self.assertEqual(grant['path'], '/view/' + aid + '/')
            self.assertEqual(grant['sameSite'].lower(), 'lax')
        self.assertFalse(any(c['name'] == '__Host-mgrant' for c in cookies))
        grant = next(c for c in cookies if c['name'] == '__Secure-mgrant-' + internal['artifact_id'])
        forged = '__Secure-mgrant-' + external['artifact_id'] + '=' + grant['value']
        rejected = fix.http.current((external['content_url']), bf.cp.ContentCommand_GetManifest(), headers={'Cookie': forged})
        self.assertEqual(rejected.status, 401)
        bf.assert_no_secrets_in_request_urls(self, out, [fix.identity.token, external['external_password']])
