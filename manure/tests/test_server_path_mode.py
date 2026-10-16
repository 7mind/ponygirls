"""Specified path-mode behavior against the real HTTP server, client and storage."""
import dataclasses
import json
import os
import tempfile
import unittest
from pathlib import Path

from manure.client import ManureClient, ManureError
from manure.domain import DomainError, ServerConfig
from manure.server import create_server
from test_server_security import _Http, _init, _make_config, _mint, _handoff_cookie


class _PathHttp(_Http):
    def content(self, artifact_id, method, path, **kw):
        return self.request(method, '/view/' + artifact_id + path, self.api_host, **kw)


class PathModeCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        user, self.token = _mint(self.tmp.name, 'u', 't')
        self.config = _make_config(self.tmp.name, [user], content_mode='path', content_suffix='')
        self.now = [1700000000.0]
        self.server = create_server(self.config, _now=lambda: self.now[0])
        self.addCleanup(self.server.close)
        self.http = _PathHttp(self.server.bound_port, self.server.effective_api_origin)

    def test_public_root_relative_assets_nested_redirects_and_ranges(self):
        aid = _init(self.http, self.token, visibility='public', kind='dir', path='nested/index.html', data=b'abcdef')
        base = self.http.api_origin + '/view/' + aid
        self.assertEqual(self.server.content_url(aid), base)
        st, headers, _ = self.http.api('GET', '/view/' + aid)
        self.assertEqual(st, 303)
        self.assertEqual(headers['Location'], '/view/' + aid + '/')
        st, headers, _ = self.http.content(aid, 'GET', '/nested')
        self.assertEqual(st, 303)
        self.assertEqual(headers['Location'], '/view/' + aid + '/nested/')
        st, headers, raw = self.http.content(aid, 'GET', '/nested/', headers={'Range': 'bytes=1-3'})
        self.assertEqual((st, raw), (206, b'bcd'))
        self.assertEqual(headers['Content-Range'], 'bytes 1-3/6')
        for bad in ('/view/xyz/', '/view/' + aid + 'x/', '/view/' + aid + '/%2e%2e/f',
                    '/view/%61' + aid[1:] + '/', '/view/' + aid + '/%2fetc',
                    '/view/' + aid + '//other', '/view/' + aid + '/%5cother'):
            st, _, _ = self.http.api('GET', bad)
            self.assertIn(st, (400, 404))
        st, _, _ = self.http.request('GET', '/', aid + '.artifacts.localhost')
        self.assertEqual(st, 400)

    def test_internal_grants_coexist_bind_artifacts_and_revoke(self):
        a = _init(self.http, self.token)
        b = _init(self.http, self.token)
        ca = _handoff_cookie(self.http, a, self.token)
        cb = _handoff_cookie(self.http, b, self.token)
        self.assertNotEqual(ca.split('=')[0], cb.split('=')[0])
        for aid in (a, b):
            st, _, data = self.http.content(aid, 'GET', '/', headers={'Cookie': ca + '; ' + cb})
            self.assertEqual((st, data), (200, b'sec-data'))
        # Even when relabelled to B's cookie name, A's grant cannot authorize B.
        forged = cb.split('=', 1)[0] + '=' + ca.split('=', 1)[1]
        st, _, _ = self.http.content(b, 'GET', '/', headers={'Cookie': forged})
        self.assertEqual(st, 401)
        for origin in (None, self.http.api_origin + '/', self.http.api_origin + '/view/' + a, 'https://other.example'):
            headers = {'Cookie': ca}
            if origin is not None:
                headers['Origin'] = origin
            st, _, _ = self.http.content(a, 'POST', '/__manure/logout', body=b'{}', ctype='application/json', headers=headers)
            self.assertEqual(st, 403)
        st, headers, _ = self.http.content(a, 'POST', '/__manure/logout', body=b'{}', ctype='application/json', headers={'Cookie': ca, 'Origin': self.http.api_origin})
        self.assertEqual(st, 200)
        self.assertIn('Path=/view/' + a + '/', headers['Set-Cookie'])
        st, _, _ = self.http.content(a, 'GET', '/', headers={'Cookie': ca})
        self.assertEqual(st, 401)
        st, _, _ = self.http.content(b, 'GET', '/', headers={'Cookie': cb})
        self.assertEqual(st, 200)
        self.server.close()
        token_path = self.config.users[0].tokens[0].hash_file
        Path(token_path).write_text('0' * 64 + '\n')
        self.server = create_server(self.config, _now=lambda: self.now[0])
        self.addCleanup(self.server.close)
        self.http = _PathHttp(self.server.bound_port, self.server.effective_api_origin)
        st, _, _ = self.http.content(b, 'GET', '/', headers={'Cookie': cb})
        self.assertEqual(st, 401)

    def test_external_client_public_and_password_rotation(self):
        source = Path(self.tmp.name, 'site')
        source.mkdir()
        (source / 'index.html').write_bytes(b'<link rel="stylesheet" href="assets/site.css">')
        (source / 'assets').mkdir()
        (source / 'assets/site.css').write_bytes(b'body {color: red}')
        client = ManureClient(self.http.api_origin, token=self.token, cache_dir=Path(self.tmp.name, 'cache'))
        anon = ManureClient(self.http.api_origin, cache_dir=Path(self.tmp.name, 'anon-cache'))
        for access in ('public', 'external'):
            result = client.upload_path(source, access=access, fresh=True)
            url = result['content_url']
            self.assertEqual(url, self.http.api_origin + '/view/' + result['artifact_id'])
            password = result.get('external_password')
            # Password is returned once on init/upload, never recovered from the catalogue.
            if access == 'external':
                password = result['external_password']
                self.assertTrue(password)
            dest = Path(self.tmp.name, 'out-' + access)
            out = anon.fetch_to_dest(url + '/assets/site.css', dest, password=password)
            self.assertEqual(out['artifact_id'], result['artifact_id'])
            self.assertEqual((dest / 'assets/site.css').read_bytes(), b'body {color: red}')
            if access == 'external':
                st, _, raw = self.http.api('POST', '/api/v1/artifacts/' + result['artifact_id'] + '/external-password:rotate', self.token, body=b'{}', ctype='application/json')
                self.assertEqual(st, 200, raw)
                with self.assertRaises(ManureError) as revoked:
                    anon.fetch_to_dest(url, Path(self.tmp.name, 'revoked'))
                self.assertEqual(revoked.exception.code, 'grant-required')

    def test_handoff_exact_origin_artifact_binding_and_single_use(self):
        a = _init(self.http, self.token)
        b = _init(self.http, self.token)
        st, _, raw = self.http.api('POST', '/api/v1/artifacts/' + a + '/grants', self.token, body=b'{}', ctype='application/json')
        self.assertEqual(st, 200, raw)
        body = json.dumps({'grant': json.loads(raw)['grant']}).encode()
        for aid, origin, expected in ((a, None, 403), (a, self.http.api_origin + '/view/' + a, 403),
                                      (b, self.http.api_origin, 403), (a, self.http.api_origin, 200),
                                      (a, self.http.api_origin, 403)):
            headers = {} if origin is None else {'Origin': origin}
            st, _, _ = self.http.content(aid, 'POST', '/__manure/grant', body=body, ctype='application/json', headers=headers)
            self.assertEqual(st, expected)

    def test_custom_unlock_shell_rewrites_only_actual_root_url_attributes(self):
        shell_dir = Path(self.tmp.name, "shell")
        shell_dir.mkdir()
        shell = """<!doctype html><HTML><body><!-- src="/comment" -->
<IMG SrC = '/styles.css'><a HREF=/help>help</a><form AcTiOn = '/__manure/unlock'></form>
<script src="//cdn.example/script.js"></script><a href='https://example.org/'>external</a>
<script>const text = 'src="/inline"';</script><p data-note='src="/data"'>text</p>
</body></HTML>"""
        (shell_dir / "index.html").write_text(shell)
        self.server.close()
        self.server = create_server(dataclasses.replace(self.config, unlock_shell_dir=str(shell_dir)))
        self.addCleanup(self.server.close)
        self.http = _PathHttp(self.server.bound_port, self.server.effective_api_origin)
        aid = _init(self.http, self.token, visibility="external")
        prefix = "/view/" + aid
        expected = shell.replace("'/styles.css'", "'" + prefix + "/styles.css'")
        expected = expected.replace("HREF=/help", 'HREF="' + prefix + '/help"')
        expected = expected.replace("'/__manure/unlock'", "'" + prefix + "/__manure/unlock'")
        st, _, raw = self.http.content(aid, "GET", "/__manure/password")
        self.assertEqual(st, 200)
        self.assertEqual(raw.decode(), expected)

    def test_expiry_hides_content_and_manifest(self):
        aid = _init(self.http, self.token, visibility='public')
        st, _, raw = self.http.api('PATCH', '/api/v1/artifacts/' + aid, self.token, body=json.dumps({'expires_in_s': 60}).encode(), ctype='application/json')
        self.assertEqual(st, 200, raw)
        self.now[0] += 60
        for path in ('/', '/__manure/manifest', '/__manure/files/f.bin/content'):
            st, _, _ = self.http.content(aid, 'GET', path)
            self.assertEqual(st, 404)


class PathConfigCase(unittest.TestCase):
    def test_original_positional_constructor_keeps_subdomain_default(self):
        with tempfile.TemporaryDirectory() as td:
            user, _ = _mint(td, 'u', 't')
            base = _make_config(td, [user])
            cfg = ServerConfig('127.0.0.1', 0, td, 'http://127.0.0.1:0',
                               'artifacts.localhost', True, users=base.users)
            self.assertEqual(cfg.content_mode, 'subdomain')
            self.assertTrue(cfg.loopback_dev)


    def test_ambiguous_artifact_shaped_api_hostname_rejected_in_path_mode(self):
        with tempfile.TemporaryDirectory() as td:
            user, _ = _mint(td, "u", "t")
            with self.assertRaisesRegex(DomainError, "artifact-id first label"):
                ServerConfig.from_dict(dict(data_dir=td, api_origin="https://" + "a" * 32 + ".api.example",
                                            users=[user], content_mode="path"))

    def test_suffix_optional_only_for_path_mode_and_mode_validated(self):
        with tempfile.TemporaryDirectory() as td:
            user, _ = _mint(td, 'u', 't')
            raw = dict(data_dir=td, api_origin='https://api.example', users=[user], content_mode='path')
            cfg = ServerConfig.from_dict(raw)
            self.assertEqual(cfg.content_suffix, '')
            self.assertEqual(cfg.content_mode, 'path')
            for mode in ('subdomain', 'invalid', None, True):
                with self.assertRaises(DomainError):
                    ServerConfig.from_dict(dict(raw, content_mode=mode))
            with self.assertRaises(DomainError):
                dataclasses.replace(cfg, content_mode='invalid')
