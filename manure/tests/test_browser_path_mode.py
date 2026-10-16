"""LOW-SECURITY path mode: real Chromium handoff/unlock and mounted-site URLs."""
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
        fix = bf.start_server(suffix_mode='path')
        self.addCleanup(fix.close)
        a, b = [bf.upload_fixture(fix, name='path-' + n, kind='dir', visibility='internal', files=FILES) for n in ('a', 'b')]
        steps = [
            {'op': 'goto', 'url': fix.api_base + '/'},
            {'op': 'fill', 'selector': '#token-input', 'value': fix.identity.token},
            {'op': 'click', 'selector': '#login-form button[type=submit]'},
            {'op': 'waitForText', 'selector': '#list-status', 'contains': 'shown'},
        ]
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
        cookies = next(x['cookies'] for x in out if x['op'] == 'cookies')
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
            {'op': 'fill', 'selector': '#token-input', 'value': fix.identity.token},
            {'op': 'click', 'selector': '#login-form button[type=submit]'},
            {'op': 'waitForText', 'selector': '#list-status', 'contains': 'shown'},
            {'op': 'waitForEval', 'fn': '() => { const rect = document.getElementById("path-mode-warning").getBoundingClientRect(); return rect.width > 0 && rect.width <= 24 && rect.height > 0 && rect.height <= 24; }'},
            {'op': 'click', 'selector': 'button[data-action=open][data-artifact-id="' + internal['artifact_id'] + '"]'},
            {'op': 'waitForEval', 'fn': '() => document.title === "PATH-OK"'},
            # This observed shared-session access is the reason path mode is LOW-SECURITY.
            {'op': 'eval', 'fn': 'async () => (await (await fetch("/api/v1/whoami")).json()).user_id'},
            {'op': 'goto', 'url': external['content_url']},
            {'op': 'waitForEval', 'fn': '() => { const icon = document.getElementById("path-mode-warning"); const rect = icon.getBoundingClientRect(); return icon.getAttribute("role") === "img" && icon.title.includes("share") && icon.textContent === "ⓘ" && rect.width > 0 && rect.width <= 24 && rect.height > 0 && rect.height <= 24; }'},
            {'op': 'fill', 'selector': 'input[name=password]', 'value': external['external_password']},
            {'op': 'click', 'selector': 'button[type=submit]'},
            {'op': 'waitForEval', 'fn': '() => document.title === "PATH-OK"'},
            {'op': 'cookies', 'urls': [internal['content_url'] + '/', external['content_url'] + '/']},
        ], ignore_https_errors=True, host_resolver_rules=bf.TLS_RESOLVER_RULES)
        self.assertTrue(all(x['ok'] for x in out), [x for x in out if not x['ok']])
        self.assertEqual(next(x['value'] for x in out if x['op'] == 'eval'), fix.identity.user_id)
        cookies = next(x['cookies'] for x in out if x['op'] == 'cookies')
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
        rejected = fix.http.request('GET', external['content_url'] + '/__manure/manifest', headers={'Cookie': forged})
        self.assertEqual(rejected.status, 401)
        bf.assert_no_secrets_in_request_urls(self, out, [fix.identity.token, external['external_password']])
