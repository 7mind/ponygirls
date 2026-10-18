"""Real browser in a non-secure, non-loopback-named HTTP context."""
import unittest
import socket
from unittest.mock import patch

import browser_fixtures as bf
from test_server_security import _init
from test_server_path_mode import _PathHttp


class HttpOptInBrowserCase(unittest.TestCase):
    def test_login_internal_handoff_external_unlock_public_and_logout(self):
        fix = bf.start_server(suffix_mode='path', config_overrides={
            'api_origin': 'http://manure-http.test:0',
            'loopback_dev': False, 'allow_insecure_http': True})
        self.addCleanup(fix.close)
        http = _PathHttp(fix.server.bound_port, fix.api_base)
        internal = _init(http, fix.identity.token, data=b'<title>HTTP-INTERNAL</title>', path='index.html')
        public = _init(http, fix.identity.token, visibility='public', data=b'<title>HTTP-PUBLIC</title>', path='index.html')
        lookup = socket.getaddrinfo
        def local_dns(host, port, *args, **kw):
            return lookup('127.0.0.1' if host == 'manure-http.test' else host, port, *args, **kw)
        with patch('socket.getaddrinfo', local_dns):
            external = bf.upload_fixture(fix, name='external-http', kind='dir', visibility='external',
                                         files={'index.html': b'<title>HTTP-EXTERNAL</title>'})
        # Exercise the real packaged dashboard and grant form navigation.
        out = bf.run_steps([
            {'op': 'goto', 'url': fix.api_base + '/'},
            {'op': 'waitForEval', 'fn': '() => !window.isSecureContext && typeof crypto.subtle === "undefined"'},
            {'op': 'fill', 'selector': '#token-input', 'value': fix.identity.token},
            {'op': 'click', 'selector': '#login-form button[type=submit]'},
            {'op': 'waitForText', 'selector': '#list-status', 'contains': 'shown'},
            {'op': 'click', 'selector': 'button[data-action=open][data-artifact-id="' + internal + '"]'},
            {'op': 'waitForEval', 'fn': '() => document.title === "HTTP-INTERNAL"'},
            {'op': 'cookies', 'urls': [fix.api_base + '/', fix.api_base + '/view/' + internal + '/']},
            {'op': 'goto', 'url': external['content_url'] + '/'},
            {'op': 'fill', 'selector': 'input[name=password]', 'value': external['external_password']},
            {'op': 'click', 'selector': 'button[type=submit]'},
            {'op': 'waitForEval', 'fn': '() => document.title === "HTTP-EXTERNAL"'},
            {'op': 'goto', 'url': fix.api_base + '/view/' + public + '/'},
            {'op': 'waitForEval', 'fn': '() => document.title === "HTTP-PUBLIC"'},
            {'op': 'goto', 'url': fix.api_base + '/'},
            {'op': 'waitForText', 'selector': '#list-status', 'contains': 'shown'},
            {'op': 'eval', 'fn': 'async () => (await fetch("/api/v1/logout", {method:"POST"})).status'},
            {'op': 'eval', 'fn': 'async () => (await fetch("/api/v1/whoami")).status'},
        ], host_resolver_rules='MAP manure-http.test 127.0.0.1')
        self.assertTrue(all(x['ok'] for x in out), [x for x in out if not x['ok']])
        cookies = next(x['cookies'] for x in out if x['op'] == 'cookies')
        self.assertTrue(any(x['name'] == 'manure-http' for x in cookies))
        self.assertTrue(any(x['name'] == 'mgrant-http-' + internal for x in cookies))
        self.assertTrue(all(not x['secure'] and x['httpOnly'] for x in cookies))
        self.assertEqual([x['value'] for x in out if x['op'] == 'eval'], [200, 401])
        bf.assert_no_secrets_in_request_urls(self, out, [fix.identity.token, external["external_password"]])
