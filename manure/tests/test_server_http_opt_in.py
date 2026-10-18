"""Explicit private-overlay HTTP endpoints, never an implicit TLS downgrade."""
import json
import tempfile
import unittest
from unittest.mock import patch
import http.server

from manure.domain import DomainError, ServerConfig
from manure.server import create_server
from test_server_security import _Http, _init, _mint, _handoff_cookie
from test_server_path_mode import _PathHttp


class HttpOptInCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        user, self.token = _mint(self.tmp.name, 'u', 't')
        self.raw = dict(data_dir=self.tmp.name + '/data', users=[user],
                        api_origin='https://tailscale.example', port=47329,
                        content_mode='path', content_suffix='',
                        dashboard_dir='package', unlock_shell_dir='package')

    def config(self, **kw):
        return ServerConfig.from_dict(dict(self.raw, **kw))

    def endpoints(self, **overrides):
        config = self.config(**dict(dict(allow_insecure_http=True,
                             allowed_api_origins=['http://netbird.example']), **overrides))
        # Keep external endpoint ports independent from the test socket.
        bind = http.server.ThreadingHTTPServer.server_bind
        def ephemeral(server):
            server.server_address = ('127.0.0.1', 0)
            bind(server)
        with patch.object(http.server.ThreadingHTTPServer, 'server_bind', ephemeral):
            server = create_server(config)
        self.addCleanup(server.close)
        return server, _PathHttp(server.bound_port, 'http://netbird.example')

    def test_config_default_and_strict_opt_in(self):
        self.assertFalse(self.config().allow_insecure_http)
        for kw in [dict(api_origin='http://netbird.example'),
                   dict(allowed_api_origins=['http://netbird.example']),
                   dict(allow_insecure_http='false'), dict(allow_insecure_http=1),
                   dict(allowed_api_origins='http://netbird.example'),
                   dict(allow_insecure_http=True, allowed_api_origins=['http://netbird.example/path']),
                   dict(allow_insecure_http=True, allowed_api_origins=['http://netbird.example:bad']),
                   dict(allow_insecure_http=True, allowed_api_origins=['http://netbird.example', 'https://netbird.example']),
                   dict(allow_insecure_http=True, allowed_api_origins=['http://netbird.example'], content_mode='subdomain', content_suffix='content.example')]:
            with self.subTest(kw=kw), self.assertRaises(DomainError):
                self.config(**kw)
        self.assertFalse(self.config(api_origin='http://netbird.example', allow_insecure_http=True).loopback_dev)

    def test_http_login_upload_grant_fetch_logout_and_https_isolation(self):
        server, http = self.endpoints()
        st, headers, _ = http.api('POST', '/api/v1/login', body=json.dumps({'token': self.token}).encode(), ctype='application/json')
        self.assertEqual(st, 200)
        self.assertNotIn('Secure', headers['Set-Cookie'])
        self.assertNotIn('__Host-', headers['Set-Cookie'])
        cookie = headers['Set-Cookie'].split(';')[0]
        self.assertEqual(http.api('GET', '/api/v1/whoami', cookie=cookie)[0], 200)
        aid = _init(http, self.token)
        st, _, raw = http.api('GET', '/api/v1/artifacts/' + aid, self.token)
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(raw)['content_url'], http.api_origin + '/view/' + aid)
        self.assertEqual(server.content_url(aid), 'https://tailscale.example/view/' + aid)
        grant_cookie = _handoff_cookie(http, aid, self.token)
        self.assertEqual(http.content(aid, 'GET', '/', headers={'Cookie': grant_cookie})[0], 200)
        self.assertEqual(http.content(aid, 'POST', '/__manure/logout', body=b'{}', ctype='application/json', headers={'Cookie': grant_cookie, 'Origin': http.api_origin})[0], 200)
        st, headers, _ = http.api('POST', '/api/v1/logout', cookie=cookie, body=b'{}', ctype='application/json')
        self.assertEqual(st, 200)
        self.assertIn('Max-Age=0', headers['Set-Cookie'])
        self.assertNotIn('Secure', headers['Set-Cookie'])
        secure = _Http(server.bound_port, 'https://tailscale.example')
        self.assertEqual(secure.api('GET', '/api/v1/health')[0], 403)
        st, headers, _ = secure.api('POST', '/api/v1/login', headers={'X-Forwarded-Proto': 'https'}, body=json.dumps({'token': self.token}).encode(), ctype='application/json')
        self.assertEqual(st, 200)
        self.assertIn('__Host-manure=', headers['Set-Cookie'])
        self.assertIn('; Secure', headers['Set-Cookie'])
        self.assertEqual(secure.api('GET', '/api/v1/whoami', cookie=cookie, headers={'X-Forwarded-Proto': 'https'})[0], 401)

    def test_python_client_and_cli_http_require_explicit_opt_in(self):
        import socket
        from pathlib import Path
        from manure.client import ManureClient, InvalidUrl, StdlibTransport
        from manure.cli import main
        server, http = self.endpoints()
        source = Path(self.tmp.name, 'source.txt')
        source.write_bytes(b'overlay content')
        client = ManureClient(http.api_origin, token=self.token,
                              allow_insecure_http=True,
                              cache_dir=Path(self.tmp.name, 'cache'))
        lookup = socket.getaddrinfo
        def local_dns(host, port, *args, **kw):
            return lookup('127.0.0.1', server.bound_port, *args, **kw)
        with patch('socket.getaddrinfo', local_dns):
            with self.assertRaises(InvalidUrl):
                ManureClient(http.api_origin, token=self.token).whoami()
            with self.assertRaises(InvalidUrl):
                StdlibTransport().request('GET', http.api_origin, {}, None)
            for access in ('internal', 'external', 'public'):
                result = client.upload_path(source, access=access, fresh=True)
                dest = Path(self.tmp.name, access + '.txt')
                target = result['artifact_id'] if access == 'internal' else result['content_url']
                client.fetch_to_dest(target, dest, password=result.get('external_password'))
                self.assertEqual((dest / source.name).read_bytes(), source.read_bytes())
            env = {'MANURE_URL': http.api_origin, 'MANURE_TOKEN': self.token,
                   'MANURE_CACHE_DIR': self.tmp.name + '/cli-cache'}
            with patch.dict('os.environ', env, clear=True):
                self.assertEqual(main(['whoami']), 2)
                self.assertEqual(main(['--allow-insecure-http', 'whoami']), 0)
            with patch.dict('os.environ', dict(env, MANURE_ALLOW_INSECURE_HTTP='1'), clear=True):
                self.assertEqual(main(['whoami']), 0)
                from manure.mcp import _client_from_env
                self.assertEqual(_client_from_env().whoami()['user_id'], 'u')
            for value in ('true', 'false', 'yes'):
                with patch.dict('os.environ', dict(env, MANURE_ALLOW_INSECURE_HTTP=value), clear=True):
                    self.assertEqual(main(['whoami']), 2)

    def test_redirect_http_opt_in_keeps_bearer_origin_scoping(self):
        from manure.client import ManureClient, InvalidUrl
        class Redirect:
            def __init__(self):
                self.calls = []
            def request(self, method, url, headers, body):
                self.calls.append((url, headers))
                return (302, {'Location': 'http://netbird.example/next'}, b'') if len(self.calls) == 1 else (200, {}, b'ok')
        for enabled in (False, True):
            transport = Redirect()
            client = ManureClient('https://tailscale.example', token=self.token,
                                  transport=transport, allow_insecure_http=enabled)
            if enabled:
                self.assertEqual(client._request('GET', client.api_base)[0], 200)
                self.assertNotIn('Authorization', transport.calls[1][1])
                self.assertNotIn('Cookie', transport.calls[1][1])
            else:
                with self.assertRaises(InvalidUrl):
                    client._request('GET', client.api_base)
                self.assertEqual(len(transport.calls), 1)

    def test_host_port_origin_and_forwarded_proto_fail_closed(self):
        server, http = self.endpoints()
        for host in ['unknown.example', 'netbird.example:443', 'tailscale.example:80']:
            self.assertEqual(http.request('GET', '/api/v1/health', host)[0], 400)
        for origin in [None, 'http://netbird.example/', 'http://unknown.example', 'https://tailscale.example']:
            self.assertEqual(http.api('POST', '/api/v1/login', origin=origin, body=json.dumps({'token': self.token}).encode(), ctype='application/json')[0], 403)
        for proto in ['http', 'https', 'https,http']:
            self.assertEqual(http.api('GET', '/api/v1/health', headers={'X-Forwarded-Proto': proto})[0], 200)
        server.close()
        server, http = self.endpoints(trusted_proxies=[])
        self.assertEqual(http.request('GET', '/api/v1/health', 'tailscale.example', headers={'X-Forwarded-Proto': 'https'})[0], 403)


if __name__ == '__main__':
    unittest.main()
