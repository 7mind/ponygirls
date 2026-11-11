"""Specified BA/BG metadata validation, CLI/MCP adapters and resume safety."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from manure import current_protocol as cp, mcp
from manure.client import ManureClient, ManureError
from test_cli_resume import run_cli
from test_current_client import CurrentTransport, AID, ORIGIN, TOKEN


class MetadataClientTests(unittest.TestCase):
    def test_upload_metadata_round_trips_without_normalization(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'report.txt'; path.write_text('report')
            transport = CurrentTransport()
            client = ManureClient(ORIGIN, TOKEN, transport=transport, cache_dir=Path(tmp) / 'cache')
            result = client.upload_path(path, 'internal', tags=[' Release ', 'release'], hostname=' HOST ', project_path='/work/A:B')
            command = transport.commands[0]
            self.assertEqual((command.tags, command.hostname, command.projectPath), ([' Release ', 'release'], ' HOST ', '/work/A:B'))
            self.assertEqual((result['tags'], result['hostname'], result['project_path']), ([' Release ', 'release'], ' HOST ', '/work/A:B'))

    def test_metadata_defaults_are_explicitly_empty(self):
        transport = CurrentTransport()
        client = ManureClient(ORIGIN, TOKEN, transport=transport)
        client.init_upload('empty', 'dir', 'internal', [])
        command = transport.commands[-1]
        self.assertEqual((command.tags, command.hostname, command.projectPath), ([], None, None))

    def test_invalid_metadata_rejected_before_any_network(self):
        transport = CurrentTransport()
        client = ManureClient(ORIGIN, TOKEN, transport=transport)
        invalid = [dict(tags='tag'), dict(tags=[1]), dict(tags=['x', 'x']), dict(tags=[' ']),
                   dict(tags=['x' * 129]), dict(tags=[str(i) for i in range(33)]),
                   dict(tags=['\ud800']), dict(hostname='\ufeff'), dict(hostname='x' * 254),
                   dict(hostname=4), dict(project_path='\t'), dict(project_path='x' * 4097),
                   dict(project_path='\udfff')]
        for fields in invalid:
            for method in ('init', 'upload', 'catalogue', 'search'):
                with self.subTest(fields=fields, method=method), self.assertRaises(ManureError) as error:
                    if method == 'init': client.init_upload('empty', 'dir', 'internal', [], **fields)
                    elif method == 'upload': client.upload_path('/nonexistent', 'internal', **fields)
                    elif method == 'catalogue': client.list_artifacts(**fields)
                    else: client.search('report', **fields)
                self.assertEqual(error.exception.code, 'bad-envelope')
        self.assertEqual(transport.requests, [])

    def test_metadata_scalar_boundaries_and_exact_filters(self):
        transport = CurrentTransport()
        client = ManureClient(ORIGIN, TOKEN, transport=transport)
        fields = dict(tags=['🦄' * 128] + [str(i) for i in range(31)], hostname='🦄' * 253, project_path='🦄' * 4096)
        client.init_upload('empty', 'dir', 'internal', [], **fields)
        client.list_artifacts(**fields)
        client.search('report', **fields)
        for command in transport.commands:
            target = command.query if isinstance(command, cp.Command_ListArtifacts) else command.query.filter if isinstance(command, cp.Command_Search) else command
            self.assertEqual((target.tags, target.hostname, target.projectPath), (fields['tags'], fields['hostname'], fields['project_path']))

    def test_cli_upload_forwards_metadata_and_rejects_duplicates_locally(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'report.txt'; path.write_text('report')
            transport = CurrentTransport()
            args = ['--cache-dir', str(Path(tmp) / 'cache'), 'upload', str(path), '--access', 'internal', '--tag', 'Release', '--tag', 'release', '--hostname', 'HOST', '--project-path', '/work/A:B', '--json']
            env = dict(MANURE_URL=ORIGIN, MANURE_TOKEN=TOKEN)
            code, out, err = run_cli(args, env, transport)
            self.assertEqual((code, err), (0, ''))
            self.assertEqual(json.loads(out)['tags'], ['Release', 'release'])
            self.assertEqual(transport.commands[0].projectPath, '/work/A:B')
            transport.requests.clear()
            code, out, err = run_cli(args + ['--tag', 'Release'], env, transport)
            self.assertEqual(code, 2)
            self.assertIn('bad-envelope', err)
            self.assertEqual(transport.requests, [])

    def test_mcp_upload_schema_checks_string_array_and_dispatches_metadata(self):
        tools = {tool['name']: tool for tool in mcp._tool_defs()}
        spec = tools['upload_artifact']['inputSchema']['properties']
        self.assertEqual(spec['tags']['type'], 'array')
        self.assertEqual(spec['tags']['items']['type'], 'string')
        args = dict(local_path='/report', access='internal', tags=['Report'], hostname='HOST', project_path='/work')
        self.assertIsNone(mcp._validate_call_args('upload_artifact', args))
        for tags in ('bad', [1], None, ['x', 'x'], [' '], list(map(str, range(33)))):
            with self.subTest(tags=tags):
                self.assertIsNotNone(mcp._validate_call_args('upload_artifact', dict(args, tags=tags)))
        with patch.object(ManureClient, 'upload_path', return_value={'ok': True}) as upload, patch.object(mcp, '_client_from_env', return_value=ManureClient(ORIGIN, TOKEN)):
            mcp.handle_tools_call('upload_artifact', args)
        self.assertEqual(upload.call_args.kwargs['tags'], ['Report'])
        self.assertEqual(upload.call_args.kwargs['hostname'], 'HOST')
        self.assertEqual(upload.call_args.kwargs['project_path'], '/work')

    def test_resume_metadata_binding_and_old_cache_defaults(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'report.txt'; path.write_text('report')
            cache = Path(tmp) / 'cache'
            transport = CurrentTransport()
            client = ManureClient(ORIGIN, TOKEN, transport=transport, cache_dir=cache)
            with patch.object(client, 'put_chunk', side_effect=ManureError('unavailable', 'interrupted')):
                with self.assertRaises(ManureError): client.upload_path(path, 'internal', tags=['Report'], hostname='HOST', project_path='/work')
            record = cache / 'uploads' / (AID + '.json')
            data = json.loads(record.read_text())
            self.assertEqual((data['tags'], data['hostname'], data['project_path']), (['Report'], 'HOST', '/work'))
            transport.requests.clear()
            with self.assertRaises(ManureError) as error:
                client.upload_path(path, 'internal', resume_id=AID, tags=['Changed'], hostname='HOST', project_path='/work')
            self.assertEqual(error.exception.code, 'bad-envelope')
            self.assertEqual(transport.requests, [])
            # A changed request initializes instead of silently reusing the old artifact.
            transport.commands.clear()
            client.upload_path(path, 'internal', tags=['Changed'], hostname='HOST', project_path='/work')
            self.assertIsInstance(transport.commands[0], cp.Command_InitUpload)
            # An older record is only compatible with explicitly empty metadata.
            with patch.object(client, 'put_chunk', side_effect=ManureError('unavailable', 'interrupted')):
                with self.assertRaises(ManureError): client.upload_path(path, 'internal', fresh=True)
            data = json.loads(record.read_text())
            for key in ('tags', 'hostname', 'project_path'): del data[key]
            record.write_text(json.dumps(data))
            client.upload_path(path, 'internal', resume_id=AID)

    def test_resume_checks_server_metadata_before_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'report.txt'; path.write_text('report')
            transport = CurrentTransport()
            client = ManureClient(ORIGIN, TOKEN, transport=transport, cache_dir=Path(tmp) / 'cache')
            with patch.object(client, 'put_chunk', side_effect=ManureError('unavailable', 'interrupted')):
                with self.assertRaises(ManureError): client.upload_path(path, 'internal', tags=['Report'])
            transport.tags = ['Changed']
            transport.commands.clear()
            with self.assertRaises(ManureError) as error: client.upload_path(path, 'internal', tags=['Report'])
            self.assertEqual(error.exception.code, 'bad-envelope')
            self.assertFalse(any(isinstance(c, cp.Command_FinishUpload) for c in transport.commands))
