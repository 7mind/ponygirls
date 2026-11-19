"""Behavioral-Active CLI usage/presentation contracts; regression provenance in commit.

Blackbox-Group tests use the owned typed transport. Real subprocess/PTY checks
exercise stream selection with synthetic credentials, not native-server acceptance.
"""
from __future__ import annotations

import errno
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import subprocess
import sys
import tempfile
import unittest

from manure import current_protocol as p
from test_cli_resume import run_cli
from test_current_client import AID, ORIGIN, TOKEN, CurrentTransport


ANSI = re.compile(r'\x1b\[[0-9;]*m')
CLI_DRIVER = '''
import sys
from manure import cli, client
from test_current_client import CurrentTransport
original = client.ManureClient
transport = CurrentTransport()
def controlled(*args, **kwargs):
    return original(*args, **kwargs, transport=transport)
client.ManureClient = controlled
raise SystemExit(cli.main(sys.argv[1:]))
'''


class CliUsageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'report.md'
        self.source.write_bytes(b'report\n')
        self.env = {'MANURE_URL': ORIGIN, 'MANURE_TOKEN': TOKEN,
                    'MANURE_CACHE_DIR': str(self.root / 'cache')}
        self.transport = CurrentTransport()

    def test_required_upload_access_is_documented_and_checked_before_credentials(self):
        code, out, err = run_cli(['upload', '--help'], {}, self.transport)
        self.assertEqual((code, err), (0, ''))
        usage = out.split('\n\n')[0]
        self.assertIn('--access {internal,external,public}', usage)
        self.assertNotIn('[--access', usage)
        for env in [{}, {'MANURE_URL': ORIGIN, 'MANURE_TOKEN_FILE': str(self.root / 'absent-token')}]:
            with self.subTest(env=sorted(env)):
                code, out, err = run_cli(['upload', str(self.source)], env, self.transport)
                self.assertEqual((code, out), (2, ''))
                self.assertIn('--access', err)
                self.assertNotIn('credentials', err)
        self.assertEqual(self.transport.requests, [])

    def test_invalid_upload_access_is_rejected_before_credentials_without_echoing_values(self):
        invalid = 'private-access-canary\n\x1b[31m'
        environments = [{}, self.env,
            {'MANURE_URL': ORIGIN, 'MANURE_TOKEN_FILE': str(self.root / 'absent-token')}]
        for env in environments:
            for resume in [[], ['--resume', AID], ['--fresh']]:
                for output in [[], ['--json', '--color', 'always']]:
                    with self.subTest(env=sorted(env), resume=resume, output=output):
                        code, out, err = run_cli(['upload', str(self.source), '--access', invalid,
                                                 *resume, *output], env, self.transport)
                        self.assertEqual((code, out), (2, ''))
                        self.assertIn('invalid-visibility', err)
                        for text in ['--access', 'internal', 'external', 'public']:
                            self.assertIn(text, err)
                        self.assertNotIn('private-access-canary', err)
                        self.assertNotIn('\x1b', err)
                        self.assertNotIn('credentials', err)
        self.assertEqual(self.transport.requests, [])

    def test_resuming_still_requires_explicit_access_before_credentials(self):
        cache = self.root / 'cache' / 'uploads'
        cache.mkdir(parents=True)
        record = cache / (AID + '.json')
        original = json.dumps({'artifact_id': AID, 'access': 'public'})
        record.write_text(original)
        for suffix in [[], ['--resume', AID]]:
            with self.subTest(explicit_resume=bool(suffix)):
                code, out, err = run_cli(['upload', str(self.source), *suffix],
                    {'MANURE_CACHE_DIR': str(cache.parent)}, self.transport)
                self.assertEqual((code, out), (2, ''))
                self.assertIn('--access', err)
                self.assertNotIn('credentials', err)
                self.assertEqual(record.read_text(), original)
        self.assertEqual(self.transport.requests, [])

    def test_cache_global_works_on_either_side_and_last_explicit_value_wins(self):
        def interrupt(method, url, headers, body):
            if method == 'PUT':
                raise ConnectionError('owned interruption')
        self.transport.override = interrupt
        for position in ['before', 'after', 'both']:
            with self.subTest(position=position):
                cache = self.root / position
                args = ['upload', str(self.source), '--access', 'internal', '--fresh']
                if position in ('before', 'both'):
                    args[:0] = ['--cache-dir', str(cache if position == 'before' else self.root / 'unused')]
                if position in ('after', 'both'):
                    args += ['--cache-dir', str(cache)]
                code, out, err = run_cli(args, self.env, self.transport)
                self.assertEqual((code, out), (1, ''), err)
                self.assertIn('unavailable', err)
                record = cache / 'uploads' / (AID + '.json')
                self.assertTrue(record.is_file())
                self.assertNotIn(TOKEN, record.read_text())
        self.assertFalse((self.root / 'unused').exists())
        self.assertFalse((self.root / 'cache').exists())

    def test_http_global_works_on_either_side_without_changing_opt_in(self):
        env = {**self.env, 'MANURE_URL': 'http://owned-fixture.example'}
        for args in [['--allow-insecure-http', 'whoami'], ['whoami', '--allow-insecure-http']]:
            with self.subTest(args=args):
                code, out, err = run_cli(args, env, self.transport)
                self.assertEqual((code, err), (0, ''))
                self.assertIn('User: u', out)
        code, out, err = run_cli(['whoami'], env, self.transport)
        self.assertEqual((code, out), (2, ''))
        self.assertIn('invalid-url', err)
        self.assertEqual(len(self.transport.requests), 2)

    def test_parser_errors_do_not_echo_values_or_terminal_controls(self):
        canary = 'private-parser-canary'
        password = 'B' * 42 + 'A'
        for args in [['whoami', '--unknown=\x1b[31m' + canary + '\x1b[0m'],
                     ['list', '--limit', canary], [canary],
                     ['--password', password, 'fetch', 'http://localhost', 'out']]:
            with self.subTest(args=args[:1]):
                code, out, err = run_cli(args, {}, self.transport)
                self.assertEqual((code, out), (2, ''))
                self.assertIn('usage:', err)
                self.assertNotIn(canary, err)
                self.assertNotIn(password, err)
                self.assertTrue(all(char.isprintable() or char == '\n' for char in err))
                self.assertIn('--help', err)
        self.assertEqual(self.transport.requests, [])

    def test_local_error_paths_are_terminal_escaped(self):
        source = str(self.root / 'absent\n\x1b[31mfile')
        code, out, err = run_cli(['upload', source, '--access', 'internal'], self.env, self.transport)
        self.assertEqual((code, out), (2, ''))
        self.assertIn('invalid-path:', err)
        self.assertIn(r'absent\n\x1b[31mfile', err)
        self.assertNotIn('\x1b', err)
        self.assertEqual(self.transport.requests, [])

    def test_common_help_explains_operand_and_safety_constraints(self):
        for command, expected in [
            ('upload', ['file or directory', '--access', 'password', '60', '31536000', '--resume', '--fresh']),
            ('fetch', ['destination directory', 'content URL', 'password-file']),
            ('list', ['--visibility', 'internal', 'external', 'public', '--state', '--cursor']),
        ]:
            with self.subTest(command=command):
                code, out, err = run_cli([command, '--help'], {}, self.transport)
                self.assertEqual((code, err), (0, ''))
                for text in expected:
                    self.assertIn(text, out)
        self.assertEqual(self.transport.requests, [])

    def test_color_changes_only_presentation_for_every_result_and_json_payload(self):
        self.transport.state = p.ArtifactState.Ready
        self.transport.files = [p.ManifestEntry_File('report.md', 7,
            hashlib.sha256(self.source.read_bytes()).hexdigest())]
        self.transport.received = {'report.md': self.source.read_bytes()}
        self.transport.name = 'untrusted\x1b[31m\nname'
        commands = [['whoami'], ['list'], ['info', AID], ['search', 'report'],
                    ['search', 'mode:lexical report'],
                    ['upload', str(self.source), '--access', 'internal', '--fresh'],
                    ['fetch', AID, str(self.root / 'download')], ['delete', AID],
                    ['rotate-password', AID]]
        for args in commands:
            with self.subTest(command=args[0]):
                code, plain, err = run_cli(args + ['--color', 'never'], self.env, self.transport)
                self.assertEqual((code, err), (0, ''))
                code, styled, err = run_cli(['--color', 'always', *args], self.env, self.transport)
                self.assertEqual((code, err), (0, ''))
                self.assertIn('\x1b[', styled)
                self.assertEqual(ANSI.sub('', styled), plain)
                code, machine, err = run_cli(['--color', 'always', *args, '--json'], self.env, self.transport)
                self.assertEqual((code, err), (0, ''))
                code, original, err = run_cli(['--json', *args, '--color', 'never'], self.env, self.transport)
                self.assertEqual((code, err), (0, ''))
                self.assertNotIn('\x1b', machine)
                self.assertEqual(machine, original)
                self.assertEqual(json.loads(machine), json.loads(original))

    def test_colored_ranked_search_preserves_evidence_exact_integers_and_provenance(self):
        page = p.SearchPage([p.SearchHit(self.transport.artifact(), 'source-version',
            'generation-id', 'policy-id', 'profile-id', 'embedding-space',
            [p.SearchEvidence(p.EvidenceField.ManifestPath, 'nested/report.md',
                'report\ntext\x1b[31m', 0.125)], 0.25)], 2**63 - 1,
            p.SearchCountScope.CandidateWindow, 1000, None, 0)
        def reply(method, url, headers, body):
            request = p.decode(p.ClientEnvelope, p.loads(body))
            return 200, {}, p.dumps(p.ServerEnvelope(request.requestId, p.Result_SearchResults(page)))
        self.transport.override = reply
        args = ['search', 'mode:hybrid report']
        code, plain, err = run_cli(args, self.env, self.transport)
        self.assertEqual((code, err), (0, ''))
        code, styled, err = run_cli(args + ['--color', 'always'], self.env, self.transport)
        self.assertEqual((code, err), (0, ''))
        self.assertIn('\x1b[', styled)
        self.assertEqual(ANSI.sub('', styled), plain)
        self.assertIn(str(2**63 - 1), plain)
        self.assertIn(r'report\ntext\x1b[31m', plain)
        code, machine, err = run_cli(['--color', 'always', *args, '--json'], self.env, self.transport)
        self.assertEqual((code, err), (0, ''))
        self.assertNotIn('\x1b', machine)
        self.assertEqual(machine, json.dumps(p.local(page), sort_keys=True, indent=2) + '\n')


class CliColorProcessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(__file__).resolve().parents[1]
        self.env = {'PATH': os.defpath, 'HOME': self.tmp.name,
            'XDG_CONFIG_HOME': self.tmp.name + '/config', 'XDG_CACHE_HOME': self.tmp.name + '/cache',
            'PYTHONPATH': os.pathsep.join([str(root), str(root / 'tests')]),
            'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'TERM': 'tmux-256color',
            'MANURE_URL': ORIGIN, 'MANURE_TOKEN': TOKEN}

    def invoke(self, args, stdout_tty, stderr_tty, extra):
        channels = []
        try:
            for tty in [stdout_tty, stderr_tty]:
                channels.append(pty.openpty() if tty else (None, subprocess.PIPE))
            process = subprocess.Popen([sys.executable, '-c', CLI_DRIVER, *args],
                stdin=subprocess.DEVNULL, stdout=channels[0][1], stderr=channels[1][1],
                env={**self.env, **extra}, cwd=self.tmp.name)
            for master, slave in channels:
                if master is not None:
                    os.close(slave)
            out, err = process.communicate(timeout=15)
            results = []
            for (master, _), value in zip(channels, [out, err]):
                if master is not None:
                    chunks = []
                    while True:
                        try:
                            chunk = os.read(master, 65536)
                        except OSError as error:
                            if error.errno == errno.EIO:
                                break
                            raise
                        if not chunk:
                            break
                        chunks.append(chunk)
                    value = b''.join(chunks)
                results.append(value.decode().replace('\r\n', '\n'))
            return process.returncode, *results
        finally:
            if 'process' in locals() and process.poll() is None:
                process.kill()
                process.communicate(timeout=5)
            for master, _ in channels:
                if master is not None:
                    os.close(master)

    def test_auto_colors_only_each_human_terminal_stream(self):
        for stdout_tty, stderr_tty in [(False, False), (True, False), (False, True), (True, True)]:
            with self.subTest(stdout_tty=stdout_tty, stderr_tty=stderr_tty):
                code, out, err = self.invoke(['whoami'], stdout_tty, stderr_tty, {})
                self.assertEqual((code, err), (0, ''))
                self.assertEqual('\x1b' in out, stdout_tty)
                self.assertEqual(ANSI.sub('', out), 'User: u\nType: agent\nToken ID: t\n')
                code, out, err = self.invoke(['whoami', '--unknown'], stdout_tty, stderr_tty, {})
                self.assertEqual((code, out), (2, ''))
                self.assertEqual('\x1b' in err, stderr_tty)

    def test_auto_environment_controls_and_explicit_overrides(self):
        for env, enabled in [({}, True), ({'NO_COLOR': ''}, True), ({'NO_COLOR': '1'}, False),
                             ({'NO_COLOR': '0'}, False), ({'TERM': 'dumb'}, False)]:
            for mode in ['auto', 'always', 'never']:
                with self.subTest(env=env, mode=mode):
                    code, out, err = self.invoke(['whoami', '--color', mode], True, True, env)
                    self.assertEqual((code, err), (0, ''))
                    self.assertEqual('\x1b' in out, enabled if mode == 'auto' else mode == 'always')
        code, out, err = self.invoke(['--color', 'always', 'whoami'], False, False,
                                     {'NO_COLOR': '1', 'TERM': 'dumb'})
        self.assertEqual((code, err), (0, ''))
        self.assertIn('\x1b', out)

    def test_help_and_errors_obey_explicit_modes_before_or_after_commands(self):
        for mode in ['always', 'never']:
            for args in [['--help'], ['upload', '--help'], ['whoami', '--unknown']]:
                for prefix, suffix in [(['--color', mode], []), ([], ['--color', mode])]:
                    with self.subTest(mode=mode, args=args, prefix=prefix):
                        code, out, err = self.invoke(prefix + args + suffix, True, True, {})
                        self.assertEqual(code, 2 if '--unknown' in args else 0)
                        self.assertEqual('\x1b' in (out + err), mode == 'always')

    def test_json_suppresses_all_ansi_for_results_help_and_errors(self):
        for args in [['whoami'], ['--help'], ['upload', '--help'], ['whoami', '--unknown']]:
            for prefix, suffix in [(['--json'], []), ([], ['--json'])]:
                with self.subTest(args=args, prefix=prefix):
                    code, out, err = self.invoke(['--color', 'always', *prefix, *args, *suffix],
                                                  True, True, {})
                    self.assertEqual(code, 2 if '--unknown' in args else 0)
                    self.assertNotIn('\x1b', out + err)
                    if args == ['whoami']:
                        self.assertEqual(json.loads(out), {'user_id': 'u', 'token_id': 't', 'type': 'agent'})

    def test_last_explicit_color_wins_and_end_of_options_is_respected(self):
        for first, last in [('never', 'always'), ('always', 'never')]:
            with self.subTest(last=last):
                code, out, err = self.invoke(['--color', first, 'whoami', '--color', last],
                                              True, True, {})
                self.assertEqual((code, err), (0, ''))
                self.assertEqual('\x1b' in out, last == 'always')
        code, out, err = self.invoke(['--color', 'always', 'info', '--', '--json'],
                                      False, False, {})
        self.assertEqual((code, out), (2, ''))
        self.assertIn('\x1b', err, 'a positional value is not a JSON output switch')
        self.assertIn('bad-envelope', err)

    def test_abbreviated_long_options_are_rejected_consistently(self):
        for args in [['--col', 'never', 'whoami'], ['whoami', '--col', 'never'],
                     ['--j', 'whoami'], ['whoami', '--j']]:
            with self.subTest(args=args):
                code, out, err = self.invoke(args, True, True, {})
                self.assertEqual((code, out), (2, ''))
                self.assertIn('--help', err)

    def test_invalid_color_is_sanitized_usage_without_credentials(self):
        for args in [['--color', '\x1b[31mprivate-color-canary', 'whoami'],
                     ['whoami', '--color'], ['whoami', '--color', 'invalid']]:
            with self.subTest(args=args[:1]):
                code, out, err = self.invoke(args, False, False, {'MANURE_URL': '', 'MANURE_TOKEN': ''})
                self.assertEqual((code, out), (2, ''))
                self.assertIn('--color', err)
                self.assertNotIn('credentials', err)
                self.assertNotIn('private-color-canary', err)
                self.assertNotIn('\x1b', err)


if __name__ == '__main__':
    unittest.main()
