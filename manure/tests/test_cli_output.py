"""Specified Behavioral-Active Blackbox-Group CLI presentation contracts.

Use the real client against the typed current transport; output assertions do
not replace the separate executable/PostgreSQL CLI acceptance cases.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from manure import current_protocol as p
from test_cli_resume import run_cli
from test_current_client import AID, CONTENT, ORIGIN, PASSWORD, TOKEN, CurrentTransport


class CliOutputTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'report.md'
        self.source.write_bytes(b'x' * 1536)
        self.env = {'MANURE_URL': ORIGIN, 'MANURE_TOKEN': TOKEN,
                    'MANURE_CACHE_DIR': str(self.root / 'cache')}
        self.transport = CurrentTransport()
        self.transport.state = p.ArtifactState.Ready
        self.transport.name = 'report.md'
        self.transport.files = [p.ManifestEntry_File('report.md', 1536,
            hashlib.sha256(self.source.read_bytes()).hexdigest())]
        self.transport.received = {'report.md': self.source.read_bytes()}
        self.transport.tags = ['release', 'quarterly report']
        self.transport.hostname = 'build-host'
        self.transport.project_path = '/work/project'

    def invoke(self, *argv):
        code, out, err = run_cli(list(argv), self.env, self.transport)
        self.assertEqual(code, 0, err)
        self.assertEqual(err, '')
        return out

    def test_whoami_is_readable_even_when_stdout_is_not_a_terminal(self):
        self.assertEqual(self.invoke('whoami'), 'User: u\nType: agent\nToken ID: t\n')

    def test_list_is_a_compact_table_with_full_ids_and_readable_sizes(self):
        out = self.invoke('list')
        lines = out.splitlines()
        self.assertEqual(lines[0].split(), ['ID', 'ACCESS', 'STATE', 'SIZE', 'NAME'])
        self.assertIn(AID, lines[1])
        self.assertIn('internal', lines[1])
        self.assertIn('ready', lines[1])
        self.assertIn('1.5 KiB', lines[1])
        self.assertTrue(lines[1].endswith('report.md'))
        self.assertIn('1 artifact', out)
        self.assertNotIn("{'", out)
        self.assertNotIn('None', out)
        self.assertNotIn(TOKEN, out)
        self.assertNotIn(PASSWORD, out)

    def test_empty_list_and_pagination_are_explicit(self):
        cursor = 'opaque-cursor'
        def page(method, url, headers, body):
            request = p.decode(p.ClientEnvelope, p.loads(body))
            return 200, {}, p.dumps(p.ServerEnvelope(request.requestId,
                p.Result_Catalogue(p.CataloguePage([], cursor))))
        self.transport.override = page
        out = self.invoke('list', '--limit', '1')
        self.assertIn('No artifacts found.', out)
        self.assertIn('Next cursor: ' + cursor, out)
        self.assertIn('--cursor', out)
        self.assertEqual(len(self.transport.requests), 1, 'must not auto-page')
        self.assertEqual(json.loads(self.invoke('list', '--json')),
                         {'artifacts': [], 'next_cursor': cursor})

    def test_info_shows_metadata_without_nested_container_representations(self):
        out = self.invoke('info', AID)
        for text in ['report.md', 'ID: ' + AID, 'URL: ' + CONTENT,
                     'Access: internal (authenticated readers only)', 'State: ready',
                     'Kind: directory', 'Size: 1.5 KiB (1536 bytes)', 'Files: 1',
                     'Created by: u', 'Created: 2026-11-03T00:00:00Z', 'Expires: never',
                     'Tags:\n  - release\n  - quarterly report', 'Hostname: build-host',
                     'Project: /work/project']:
            self.assertIn(text, out)
        self.assertNotIn("['", out)
        self.assertNotIn('None', out)

    def test_expiry_and_absent_optional_metadata_are_readable(self):
        original = self.transport.artifact()
        artifact = p.Artifact(**{**original.__dict__, 'expiresAt': '2026-12-01T00:00:00Z',
            'tags': [], 'hostname': None, 'projectPath': None, 'contentUrl': ''})
        def info(method, url, headers, body):
            request = p.decode(p.ClientEnvelope, p.loads(body))
            return 200, {}, p.dumps(p.ServerEnvelope(request.requestId, p.Result_ArtifactInfo(artifact)))
        self.transport.override = info
        out = self.invoke('info', AID)
        self.assertIn('Expires: 2026-12-01T00:00:00Z', out)
        self.assertIn('URL: unavailable', out)
        self.assertIn('Tags: none', out)
        self.assertNotIn('Hostname:', out)
        self.assertNotIn('Project:', out)

    def test_size_boundaries_and_plural_counts_are_readable(self):
        for size, expected in [(0, '0 bytes'), (1, '1 byte'), (1023, '1023 bytes'),
                               (1024, '1.0 KiB (1024 bytes)'), (2**20, '1.0 MiB (1048576 bytes)'),
                               (2**30, '1.0 GiB (1073741824 bytes)')]:
            with self.subTest(size=size):
                self.transport.files = [p.ManifestEntry_File('file', size, '0' * 64)]
                self.assertIn('Size: ' + expected + '\n', self.invoke('info', AID))
        artifact = self.transport.artifact()
        def page(method, url, headers, body):
            request = p.decode(p.ClientEnvelope, p.loads(body))
            return 200, {}, p.dumps(p.ServerEnvelope(request.requestId,
                p.Result_Catalogue(p.CataloguePage([artifact, artifact], None))))
        self.transport.override = page
        self.assertIn('2 artifacts', self.invoke('list'))

    def test_upload_describes_access_and_generated_password_only_when_present(self):
        for access, meaning in [('internal', 'authenticated readers only'),
                                ('public', 'anyone with the link'),
                                ('external', 'password required')]:
            with self.subTest(access=access):
                out = self.invoke('upload', str(self.source), '--access', access, '--fresh',
                                  '--tag', 'release', '--hostname', 'build-host')
                self.assertIn('Uploaded artifact ' + AID, out)
                self.assertIn('URL: ' + CONTENT, out)
                self.assertIn(f'Access: {access} ({meaning})', out)
                self.assertIn('Expires: never', out)
                self.assertIn('Tags:\n  - release', out)
                self.assertIn('Hostname: build-host', out)
                self.assertNotIn(TOKEN, out)
                if access == 'external':
                    self.assertIn('External password: ' + PASSWORD, out)
                else:
                    self.assertNotIn('password:', out)
                    self.assertNotIn(PASSWORD, out)

    def test_resumed_external_upload_explains_missing_password(self):
        self.transport.state = p.ArtifactState.Uploading
        self.transport.received = {}
        def interrupt(method, url, headers, body):
            if method == 'PUT':
                raise ConnectionError('controlled interrupted upload')
        self.transport.override = interrupt
        args = ['upload', str(self.source), '--access', 'external',
                '--tag', 'release', '--tag', 'quarterly report',
                '--hostname', 'build-host', '--project-path', '/work/project']
        code, out, err = run_cli(args, self.env, self.transport)
        self.assertEqual((code, out), (1, ''))
        self.assertIn('unavailable', err)
        self.assertTrue((self.root / 'cache' / 'uploads' / (AID + '.json')).is_file())
        self.transport.override = None
        out = self.invoke(*args, '--resume', AID)
        self.assertIn('External password: not returned on resume', out)
        self.assertIn('rotate-password to re-issue', out)
        self.assertNotIn('None', out)
        self.assertNotIn(PASSWORD, out)

    def test_fetch_reports_destination_and_verified_file_totals(self):
        dest = self.root / 'download'
        out = self.invoke('fetch', AID, str(dest))
        self.assertIn('Fetched artifact ' + AID, out)
        self.assertIn('Destination: ' + str(dest), out)
        self.assertIn('Files: 1', out)
        self.assertIn('Size: 1.5 KiB (1536 bytes)', out)
        self.assertEqual((dest / 'report.md').read_bytes(), self.source.read_bytes())

    def test_mutation_acknowledgements_identify_the_artifact(self):
        self.assertEqual(self.invoke('delete', AID), 'Deleted artifact ' + AID + '.\n')
        out = self.invoke('rotate-password', AID)
        self.assertIn('Rotated password for artifact ' + AID, out)
        self.assertIn('External password: ' + PASSWORD, out)
        self.assertIn('Previous password and grants have been revoked.', out)
        self.assertNotIn(TOKEN, out)

    def test_json_flag_works_before_and_after_every_command_without_changing_payloads(self):
        for location in ['before', 'after', 'both']:
            for command in ['whoami', 'list', 'info', 'upload', 'fetch', 'delete', 'rotate-password']:
                with self.subTest(location=location, command=command):
                    args = [command]
                    if command in ('info', 'delete', 'rotate-password'):
                        args += [AID]
                    elif command == 'upload':
                        args += [str(self.source), '--access', 'internal', '--fresh']
                    elif command == 'fetch':
                        args += [AID, str(self.root / ('json-' + location))]
                    expected = {
                        'whoami': {'user_id': 'u', 'type': 'agent', 'token_id': 't'},
                        'list': {'artifacts': [p.local(self.transport.artifact())], 'next_cursor': None},
                        'info': p.local(self.transport.artifact()),
                        'upload': {'artifact_id': AID, 'content_url': CONTENT, 'access': 'internal',
                                   'expires_at': None, 'tags': [], 'hostname': None, 'project_path': None},
                        'fetch': {'artifact_id': AID, 'dest': str(self.root / ('json-' + location)),
                                  'file_count': 1, 'total_bytes': 1536},
                        'delete': {'ok': True}, 'rotate-password': {'external_password': PASSWORD},
                    }[command]
                    if location in ('before', 'both'):
                        args.insert(0, '--json')
                    if location in ('after', 'both'):
                        args.append('--json')
                    out = self.invoke(*args)
                    self.assertEqual(json.loads(out), expected)
                    self.assertEqual(out, json.dumps(expected, sort_keys=True, indent=2) + '\n')

    def test_help_documents_output_selection_without_credentials_or_network(self):
        for argv in [['--help'], ['delete', '--help'], ['list', '--help']]:
            with self.subTest(argv=argv):
                code, out, err = run_cli(argv, {}, self.transport)
                self.assertEqual((code, err), (0, ''))
                self.assertIn('--json', out)
        self.assertEqual(self.transport.requests, [])

    def test_untrusted_text_cannot_emit_terminal_controls_or_forge_extra_rows(self):
        self.transport.name = 'résumé\nforged\r\t\x1b[31m\x00\x9b\u202e.txt'
        self.transport.tags = ['a\nb', r'c\d']
        for command in [('info', AID), ('list',)]:
            with self.subTest(command=command):
                out = self.invoke(*command)
                self.assertIn(r'résumé\nforged\r\t\x1b[31m\x00\x9b\u202e.txt', out)
                self.assertTrue(all(ch.isprintable() or ch == '\n' for ch in out))
        out = self.invoke('info', AID)
        self.assertIn(r'a\nb', out)
        self.assertIn(r'c\\d', out)
        self.assertEqual(json.loads(self.invoke('info', AID, '--json'))['name'], self.transport.name)

    def test_errors_keep_exit_codes_stderr_and_empty_stdout_in_both_modes(self):
        def failure(method, url, headers, body):
            request = p.decode(p.ClientEnvelope, p.loads(body))
            return 401, {}, p.dumps(p.ServerEnvelope(request.requestId,
                p.Result_Error(p.Failure(p.ErrorCode.Unauthorized, 'canary-' + TOKEN, None))))
        self.transport.override = failure
        for suffix in [[], ['--json']]:
            for args, expected_code, expected_error in [(['whoami'], 1, 'unauthorized'),
                                                       (['info', 'invalid'], 2, 'bad-envelope')]:
                with self.subTest(args=args, suffix=suffix):
                    code, out, err = run_cli(args + suffix, self.env, self.transport)
                    self.assertEqual((code, out), (expected_code, ''))
                    self.assertIn(expected_error, err)
                    self.assertNotIn(TOKEN, err)
                    self.assertNotIn(PASSWORD, err)
                    self.assertNotIn('canary', err)


if __name__ == '__main__':
    unittest.main()
