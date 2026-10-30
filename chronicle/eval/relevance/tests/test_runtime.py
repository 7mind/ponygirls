"""Behavioral-Active Blackbox contracts for owned lifecycle/configuration boundaries."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import bridge
import evaluate

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import run_real
import runtime


def runner_workflow():
    return {'sourcePolicy':'archived-bridge-v1','fingerprintPolicy':'full-state-v1',
            'protocolPolicy':'evidence-navigation-v3','catalogVariant':'context',
            'executorCodecs':{'project':'/executor','files':[{'relativePath':'generated/typescript/current.ts','sha256':'a'*64}]},
            'rubric':{'path':'/rubric','sha256':'b'*64},
            'batch':{'batchId':'b','arm':'a','repeat':1,'schedule':{'path':'/master','sha256':'c'*64}}}


class RuntimeContracts(unittest.TestCase):
    def test_requested_identity_must_match_read_token_identity(self):
        class WrongPrincipal:
            calls = 0
            bytes = 0
            started = 0
            def __init__(self, *args, **kwargs):
                pass
            def call(self, name, arguments, principal):
                if name == 'whoami':
                    return {'user': {'id': 'restricted', 'scopes': ['Read']}}
                return {}
            def close(self):
                pass
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            manifest = {key: 'synthetic' for key in ('profile', 'profileSha256', 'modelCatalogSha256', 'runId', 'origin', 'pid', 'executable', 'elfSha256')}
            evaluate.save(directory / 'owned.json', manifest)
            evaluate.save(directory / 'request.json', {'name': 'get_session', 'arguments': {}})
            args = ['bridge.py', 'call', '--manifest', str(directory / 'owned.json'), '--fixture', str(ROOT / 'fixtures.json'),
                    '--out', str(directory / 'out'), '--request', str(directory / 'request.json'),
                    '--mode', 'semantic', '--related-policy', 'deny', '--principal', 'reader']
            with patch.object(bridge, 'Bridge', WrongPrincipal), patch.object(sys, 'argv', args):
                with self.assertRaises(ValueError):
                    bridge.main()

    def test_clone_rejects_source_overlap_before_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            prepared = Path(temporary) / 'seed'; prepared.mkdir()
            (prepared / 'data').mkdir(); (prepared / 'data/PG_VERSION').write_text('18')
            evaluate.save(prepared / 'prepared.json', {'status': 'Prepared', 'dataFiles': run_real.data_inventory(prepared / 'data'), 'preparedFiles': {}})
            evaluate.save(prepared / 'cleanup.json', {'ownedChildrenReaped': True, 'cleanupErrors': []})
            keys = ('native', 'postgres', 'fixture', 'annotation', 'embedding', 'factFormat', 'agentModel', 'generatedFiles', 'generatedProject', 'configTemplate')
            bindings = {key: 'same' for key in keys}
            artifact = prepared / 'publisher'; artifact.write_text('publication-native')
            bindings['native'] = {'path': str(artifact), 'sha256': evaluate.digest(artifact)}
            bindings['preparedNative'] = bindings['native']
            bindings['workflow'] = runner_workflow()
            evaluate.save(prepared / 'bindings.json', dict(bindings, preparedNative=None))
            output = prepared / 'data/nested'; output.mkdir()
            with patch.object(run_real.shutil, 'copytree', side_effect=RuntimeError('unsafe copy attempted')) as copier:
                with self.assertRaises(ValueError):
                    run_real.clone_prepared(prepared, output, bindings)
                copier.assert_not_called()

    def test_schedule_is_seeded_interleaved_and_split_stable(self):
        fixture = {'modeOrderSeed': 20261029, 'tasks': [
            {'id': 'a', 'split': 'dev'}, {'id': 'b', 'split': 'holdout'}, {'id': 'c', 'split': 'holdout'}]}
        modes = ['lexical', 'semantic', 'hybrid']
        schedule = run_real.trial_schedule(fixture, modes, 'holdout')
        self.assertEqual(schedule, run_real.trial_schedule(fixture, modes, 'holdout'))
        self.assertEqual([cell['taskId'] for cell in schedule], ['b'] * 3 + ['c'] * 3)
        for identity in ('b', 'c'):
            self.assertEqual({cell['mode'] for cell in schedule if cell['taskId'] == identity}, set(modes))

    def test_offline_clone_copies_bytes_permissions_without_hardlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); prepared = root / 'seed'; prepared.mkdir()
            data = prepared / 'data'; data.mkdir(); (data / 'PG_VERSION').write_text('18'); (data / 'PG_VERSION').chmod(0o600)
            keys = ('native', 'postgres', 'fixture', 'annotation', 'embedding', 'factFormat', 'agentModel', 'generatedFiles', 'generatedProject', 'configTemplate')
            bindings = {key: 'same' for key in keys}
            artifact = prepared / 'publisher'; artifact.write_text('publication-native')
            bindings['native'] = {'path': str(artifact), 'sha256': evaluate.digest(artifact)}
            bindings['preparedNative'] = bindings['native']
            bindings['workflow'] = runner_workflow()
            evaluate.save(prepared / 'bindings.json', {key:value for key,value in dict(bindings, preparedNative=None).items() if key != 'workflow'})
            evaluate.save(prepared / 'prepared.json', {'status': 'Prepared', 'dataFiles': run_real.data_inventory(data), 'preparedFiles': {}})
            evaluate.save(prepared / 'cleanup.json', {'ownedChildrenReaped': True, 'cleanupErrors': []})
            for name in ('database-password', 'browser-password', 'password-hash', 'reader-read', 'reader-ingest', 'restricted-read', 'restricted-ingest'):
                path = prepared / name; path.write_text('synthetic'); path.chmod(0o600)
            output = root / 'clone'; output.mkdir()
            run_real.clone_prepared(prepared, output, bindings)
            self.assertEqual(run_real.data_inventory(output / 'data'), run_real.data_inventory(data))
            self.assertNotEqual((output / 'data/PG_VERSION').stat().st_ino, (data / 'PG_VERSION').stat().st_ino)
            (output / 'data/PG_VERSION').write_text('changed')
            self.assertEqual((data / 'PG_VERSION').read_text(), '18')
            (data / 'PG_VERSION').chmod(0o644)
            other = root / 'other'; other.mkdir()
            with self.assertRaises(ValueError):
                run_real.clone_prepared(prepared, other, bindings)

    def test_explicit_executor_variant_clones_the_same_publisher_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); prepared = root / 'seed'; prepared.mkdir(); (prepared / 'data').mkdir()
            (prepared / 'data/PG_VERSION').write_text('18')
            old_native = root / 'publisher'; old_native.write_text('publisher max')
            executor = root / 'executor'; executor.write_text('executor high')
            keys = ('postgres', 'fixture', 'annotation', 'embedding', 'factFormat', 'agentModel', 'generatedFiles', 'generatedProject', 'configTemplate')
            prior = {key: 'unchanged' for key in keys}
            prior['native'] = {'path': str(old_native), 'sha256': evaluate.digest(old_native)}
            evaluate.save(prepared / 'bindings.json', prior)
            proof = {'status': 'Prepared', 'dataFiles': run_real.data_inventory(prepared / 'data'),
                     'preparedFiles': {'bindings.json': evaluate.digest(prepared / 'bindings.json')}}
            evaluate.save(prepared / 'prepared.json', proof)
            evaluate.save(prepared / 'cleanup.json', {'ownedChildrenReaped': True, 'cleanupErrors': []})
            for name in ('database-password', 'browser-password', 'password-hash', 'reader-read', 'reader-ingest', 'restricted-read', 'restricted-ingest'):
                path = prepared / name; path.write_text('synthetic'); path.chmod(0o600)
            expected_metadata = {name: (prepared / name).read_bytes() for name in ('bindings.json', 'prepared.json')}
            bindings = dict(prior, preparedNative=prior['native'], native={'path': str(executor), 'sha256': evaluate.digest(executor)}, workflow=runner_workflow())
            output = root / 'clone'; output.mkdir()
            self.assertEqual(run_real.clone_prepared(prepared, output, bindings), proof)
            self.assertEqual(run_real.data_inventory(output / 'data'), proof['dataFiles'])
            self.assertNotEqual((output / 'data/PG_VERSION').stat().st_ino, (prepared / 'data/PG_VERSION').stat().st_ino)
            for name, raw in expected_metadata.items():
                self.assertEqual((prepared / name).read_bytes(), raw)
            self.assertEqual(evaluate.load(prepared / 'bindings.json')['native'], prior['native'])
            with patch.object(run_real.shutil, 'copytree') as copier:
                for field in keys:
                    with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'prepared binding differs: ' + field):
                        run_real.clone_prepared(prepared, root / ('changed-' + field), dict(bindings, **{field: 'changed'}))
                for publisher in (None, bindings['native']):
                    with self.subTest(publisher=publisher), self.assertRaisesRegex(ValueError, 'publisher native binding differs'):
                        run_real.clone_prepared(prepared, root / 'wrong-publisher', dict(bindings, preparedNative=publisher))
                missing = dict(bindings); del missing['preparedNative']
                with self.assertRaisesRegex(ValueError, 'publisher native binding differs'):
                    run_real.clone_prepared(prepared, root / 'missing-publisher', missing)
                old_bytes = old_native.read_bytes(); old_native.write_text('tampered publisher')
                with self.assertRaisesRegex(ValueError, 'digest mismatch'):
                    run_real.clone_prepared(prepared, root / 'tampered-publisher', dict(bindings, fixture='changed'))
                old_native.write_bytes(old_bytes)
                copier.assert_not_called()

    def test_execution_bindings_require_explicit_publication_role_and_typed_agent_metadata(self):
        publisher = {'path': '/declared/publisher', 'sha256': 'a' * 64}
        bindings = {'preparedNative': None, 'agentReasoningPolicy': 'max', 'agentMaximumOutputTokens': 65536,
                    'agentRevision': 'pinned-revision'}
        run_real.validate_execution_bindings(bindings, 'prepare')
        run_real.validate_execution_bindings(dict(bindings, preparedNative=publisher, agentReasoningPolicy='high'), 'run')
        for field in ('preparedNative', 'agentReasoningPolicy', 'agentMaximumOutputTokens', 'agentRevision'):
            with self.subTest(missing=field):
                missing = dict(bindings); del missing[field]
                with self.assertRaises(ValueError):
                    run_real.validate_execution_bindings(missing, 'prepare')
        for field, values in {'agentReasoningPolicy': [None, 1, ' high', 'low'],
                              'agentMaximumOutputTokens': [None, True, 0, '65536'],
                              'agentRevision': [None, 1017, '', ' revision ']}.items():
            for value in values:
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    run_real.validate_execution_bindings(dict(bindings, **{field: value}), 'prepare')
        with self.assertRaises(ValueError):
            run_real.validate_execution_bindings(dict(bindings, preparedNative=publisher), 'prepare')
        for value in (None, 'publisher', {}, {'path': 'publisher', 'sha256': 'bad'}):
            with self.subTest(runPublisher=value), self.assertRaises(ValueError):
                run_real.validate_execution_bindings(dict(bindings, preparedNative=value), 'run')

    def test_normalization_failure_never_becomes_valid_empty_trace(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'trace.jsonl'; path.write_text('')
            outcome = {'traceComplete': False, 'failure': {'type': 'trace-normalization-failed', 'message': 'recorded parser failure'}}
            events, failure = run_real.read_evaluation_trace(path, outcome)
            self.assertEqual(events, [])
            self.assertEqual(failure['type'], 'trace-normalization-failed')
            outcome = {'traceComplete': False, 'failure': None}
            self.assertEqual(run_real.read_evaluation_trace(path, outcome)[1]['type'], 'incomplete-trace')
            outcome = {'traceComplete': True, 'failure': None}
            self.assertEqual(run_real.read_evaluation_trace(path, outcome), ([], None))

    def test_matrix_budget_scales_with_actual_selected_cells(self):
        self.assertEqual(run_real.matrix_seconds([1] * 16, ['lexical', 'semantic', 'hybrid'], 120, 900),
                         120 + 900 + 48 * 990)
        with self.assertRaises(ValueError):
            run_real.matrix_seconds([], ['lexical'], 120, 900)

    def test_token_free_is_explicit_and_exactly_empty(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'credential'; path.write_text(''); path.chmod(0o600)
            self.assertEqual(run_real.credential(path, 'token-free'), path.resolve())
            with self.assertRaises(ValueError):
                run_real.credential(path, 'bearer')
            path.write_text(' ')
            with self.assertRaises(ValueError):
                run_real.credential(path, 'token-free')
            path.write_text('synthetic'); path.chmod(0o644)
            with self.assertRaises(ValueError):
                run_real.credential(path, 'bearer')

    def test_cleanup_attempts_later_stages_after_first_failure(self):
        class ControlledRun:
            children = [('first',), ('last',)]
            exits = []
            def stop(self, item):
                attempts.append(item[0])
                if item[0] == 'last':
                    raise RuntimeError('injected managed stop failure')
        attempts = []
        def adopted():
            attempts.append('adopted')
            return []
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with self.assertRaises(RuntimeError):
                runtime.finish(ControlledRun(), directory, None, {'status': 'Completed'}, adopted)
            result = json.loads((directory / 'cleanup.json').read_text())
            self.assertEqual(attempts, ['last', 'first', 'adopted'])
            self.assertFalse(result['ownedChildrenReaped'])
            self.assertFalse(result['externalProvidersManaged'])
            self.assertEqual(result['summaryStatus'], 'cleanup-failed')
            self.assertFalse((directory / 'summary.json').exists())

    def test_stopped_data_inventory_rejects_running_or_symlinked_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary); (directory / 'PG_VERSION').write_text('18')
            self.assertEqual(set(run_real.data_inventory(directory)), {'.', 'PG_VERSION'})
            (directory / 'postmaster.pid').write_text('1')
            with self.assertRaises(ValueError):
                run_real.data_inventory(directory)
            (directory / 'postmaster.pid').unlink()
            (directory / 'symlink').symlink_to(directory / 'PG_VERSION')
            with self.assertRaises(ValueError):
                run_real.data_inventory(directory)

    def test_owned_child_stops_and_records_real_exit(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            run = runtime.Run(directory, {'PATH': os.defpath}, 10)
            process = run.start('owned', [sys.executable, '-c', 'import time;time.sleep(60)'])
            run.stop(run.children[0]); run.stop(run.children[0])
            self.assertIsNotNone(process.poll())
            self.assertEqual(len(run.exits), 1)
            self.assertEqual(run.exits[0]['pid'], process.pid)


if __name__ == '__main__':
    unittest.main()
