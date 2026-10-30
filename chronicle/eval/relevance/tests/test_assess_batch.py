"""Behavioral-Active Blackbox-Group, model-free captured-layout contracts."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import evaluate
import assess_batch


def inventory(root):
    return {str(path): evaluate.digest(path) for path in root.rglob('*') if path.is_file()}


class BatchAssessmentContracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name); self.original = self.root / 'original'; self.original.mkdir()
        self.fixture_path = self.root / 'fixture.json'
        shutil.copy2(ROOT / 'tests/data/proposition-source-subset.json', self.fixture_path)
        self.fixture = evaluate.load(self.fixture_path); fixture_sha = evaluate.digest(self.fixture_path)
        rubric = evaluate.load(ROOT / 'semantic-propositions.json'); rubric['fixtureSha256'] = fixture_sha
        rubric['tasks'] = {task['id']: rubric['tasks'][task['id']] for task in self.fixture['tasks']}
        self.rubric = self.root / 'rubric.json'; evaluate.save(self.rubric, rubric)
        self.catalog = {doc['id']: {'sessionId': doc['id'], 'view': {'revision': 1, 'generationId': 'g-' + doc['id']}}
                        for doc in self.fixture['documents']}
        evaluate.save(self.original / 'bindings.json', {'fixture': {'path': str(self.fixture_path), 'sha256': fixture_sha}})
        (self.original / 'preflight').mkdir()
        evaluate.save(self.original / 'preflight/catalog.json', {'fixtureSha256': fixture_sha, 'documents': self.catalog})
        self.credential = self.original / 'private-credential'; self.credential.write_text('synthetic-never-read-by-adapter')
        self.groups = {}
        for task_id, mode, state in [('q01', 'semantic', 'Complete'), ('q03', 'hybrid', 'Failed')]:
            task = next(task for task in self.fixture['tasks'] if task['id'] == task_id)
            group = self.original / ('agent-' + mode + '-' + task_id); group.mkdir(); opaque = 'opaque-' + task_id
            directory = group / opaque; directory.mkdir(); self.groups[task_id] = (group, directory)
            evaluate.save(group / 'input.json', {'tasks': [{'id': opaque, 'question': task['question']}], 'login': 'reader',
                'mode': mode, 'project': 'project', 'relatedPolicy': 'deny', 'passwordFile': str(self.credential)})
            evaluate.save(group / 'evaluator-private-map.json', {opaque: task_id})
            evaluate.save(group / 'client-exit.json', {'exit': 0 if state == 'Complete' else 2})
            run = {'instanceId': 'instance', 'runId': 'run-' + opaque, 'taskId': opaque}; evaluate.save(directory / 'run.json', run)
            native_failure = None if state == 'Complete' else {'code': 'mcp-context-limit', 'message': 'no retry'}
            failure = None if state == 'Complete' else {'type': 'model-run-failed', 'state': state, 'failure': native_failure}
            evaluate.save(directory / 'outcome.json', {'taskId': opaque, 'state': state, 'failure': failure,
                'traceComplete': True, 'conditionViolations': 0})
            page = {'instanceId': run['instanceId'], 'runId': run['runId'], 'state': state, 'failure': native_failure,
                    'events': [], 'lastSequence': '0', 'hasMore': False}
            evaluate.save(directory / 'page-0000.json', page); evaluate.save(directory / 'events.json', [])
            events = []
            if task_id == 'q01':
                for result in (None, ['d02'], ['d01']):
                    event = {'taskId': opaque, 'tool': 'search_sessions', 'arguments': {'mode': mode, 'project': 'project'}}
                    event.update(error='controlled search failure') if result is None else event.update(result={'hits': [{'session': {'id': key}} for key in result]})
                    events.append(event)
                document = next(doc for doc in self.fixture['documents'] if doc['id'] == 'd01')
                events.append({'taskId': opaque, 'tool': 'get_messages', 'arguments': {'sessionId': 'd01'},
                    'result': {'view': self.catalog['d01']['view'], 'messages': evaluate.messages(document)}})
                evaluate.save(directory / 'answer.json', {'taskId': opaque, 'facts': task['facts'], 'abstain': False,
                    'citations': [{'sessionId': 'd01', 'view': self.catalog['d01']['view'], 'messageId': 'm', 'quote': 'last confirmed offset'}]})
            (directory / 'trace.jsonl').write_text(''.join(json.dumps(event) + '\n' for event in events))
            baseline = self.original / ('baseline-' + mode + '-' + task_id); baseline.mkdir()
            evaluate.save(baseline / 'retrieval.json', {'hits': [{'session': {'id': key}} for key in (['d02', 'd01'] if task_id == 'q01' else [])]})
        evaluate.save(self.original / 'schedule.json', {'trials': [{'mode': 'semantic', 'taskId': 'q01'}, {'mode': 'hybrid', 'taskId': 'q03'}]})

    def run_adapter(self, observed, output):
        return subprocess.run([sys.executable, str(ROOT / 'assess_batch.py'), '--original', str(self.original),
            '--observed', str(observed), '--rubric', str(self.rubric), '--out', str(output)], capture_output=True, text=True)

    def rewrite(self, path, change):
        value = evaluate.load(path); change(value); path.write_text(json.dumps(value) + '\n')

    def sidecars(self):
        observed = self.root / 'observed'; observed.mkdir()
        for group, native in self.groups.values():
            directory = observed / group.name / native.name; directory.mkdir(parents=True)
            for name in ('outcome.json', 'trace.jsonl', 'answer.json'):
                if (native / name).exists():
                    shutil.copy2(native / name, directory / name)
            self.rewrite(directory / 'outcome.json', lambda value: value.update(originalControllerOutcomeSha256=evaluate.digest(native / 'outcome.json')))
        parser = observed / 'parser-source'; parser.mkdir(); parser_hashes = {}
        for name in ('reparse.mjs', 'live_protocol.mjs'):
            (parser / name).write_text('controlled historical parser snapshot ' + name)
            parser_hashes['/historical-not-installed/' + name] = evaluate.digest(parser / name)
        originals = {str(path): evaluate.digest(path) for group, _ in self.groups.values() for path in group.rglob('*.json')}
        evaluate.save(observed / 'source-manifest.json', {'originalFiles': originals, 'parserSources': parser_hashes})
        return observed

    def test_portable_cli_preserves_inputs_native_failure_and_nonpooled_metrics(self):
        before = inventory(self.original); output = self.root / 'assessment'
        process = self.run_adapter(self.original, output); self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(inventory(self.original), before)
        summary = evaluate.load(output / 'summary.json'); results = {item['taskId']: item for item in summary['tasks']}
        positive = results['q01']; self.assertTrue(positive['groundedAnswerSuccessV2']); self.assertFalse(positive['answerSuccess'])
        self.assertEqual((positive['fixedRecallAt1'], positive['fixedRecallAt5'], positive['fixedMrr']), (0, 1, .5))
        self.assertEqual((positive['recallAtK'], positive['mrr'], positive['anyQueryRequiredCoverage']), (0, 0, 1))
        self.assertFalse(positive['firstAttemptedSearchSucceeded']); self.assertIsNone(positive['firstAttemptedRecallAt5'])
        failed = results['q03']; self.assertFalse(failed['groundedAnswerSuccessV2']); self.assertFalse(failed['answerAvailable'])
        self.assertEqual(failed['originalNativeState'], 'Failed'); self.assertEqual(failed['sourceNativeFailure']['code'], 'mcp-context-limit')
        self.assertEqual(failed['originalControllerExit'], 2)
        manifest = evaluate.load(output / 'input-manifest.json'); self.assertNotIn(str(self.credential), manifest)
        for name in ('assess_batch.py', 'evaluate.py', 'proposition_support.py'):
            self.assertEqual(manifest[str((ROOT / name).resolve())], evaluate.digest(ROOT / name))
        again = self.run_adapter(self.original, output); self.assertNotEqual(again.returncode, 0)
        self.assertEqual(inventory(self.original), before)

    def test_identity_question_principal_and_model_projection_are_checked(self):
        group, directory = self.groups['q01']
        cases = [('answer.json', directory, lambda v: v.update(taskId='wrong'), 'opaque answer'),
                 ('outcome.json', directory, lambda v: v.update(taskId='wrong'), 'opaque outcome'),
                 ('input.json', group, lambda v: v['tasks'][0].update(question='oracle'), 'question mismatch'),
                 ('input.json', group, lambda v: v['tasks'][0].update(facts={}), 'evaluator-only'),
                 ('input.json', group, lambda v: v.update(login='restricted'), 'principal mismatch')]
        for index, (name, base, change, message) in enumerate(cases):
            with self.subTest(message=message):
                path = base / name; raw = path.read_bytes(); self.rewrite(path, change)
                process = self.run_adapter(self.original, self.root / ('invalid-' + str(index)))
                self.assertNotEqual(process.returncode, 0); self.assertIn(message, process.stderr); path.write_bytes(raw)
        path = directory / 'trace.jsonl'; events = [json.loads(line) for line in path.read_text().splitlines()]
        events[0]['taskId'] = 'wrong'; path.write_text(''.join(json.dumps(event) + '\n' for event in events))
        process = self.run_adapter(self.original, self.root / 'invalid-trace')
        self.assertNotEqual(process.returncode, 0); self.assertIn('opaque trace', process.stderr)

    def test_output_overlap_is_rejected_before_creation(self):
        before = inventory(self.original); nested = self.original / 'must-not-create'
        process = self.run_adapter(self.original, nested)
        self.assertNotEqual(process.returncode, 0); self.assertIn('disjoint', process.stderr)
        self.assertFalse(nested.exists()); self.assertEqual(inventory(self.original), before)

    def test_sidecar_lineage_is_checked_without_historical_module_paths(self):
        observed = self.sidecars(); before = inventory(self.original); observed_before = inventory(observed)
        process = self.run_adapter(observed, self.root / 'sidecar-assessment')
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(inventory(self.original), before); self.assertEqual(inventory(observed), observed_before)
        manifest_path = observed / 'source-manifest.json'
        self.rewrite(manifest_path, lambda v: v['originalFiles'].update({str(self.fixture_path): evaluate.digest(self.fixture_path)}))
        process = self.run_adapter(observed, self.root / 'wrong-source')
        self.assertNotEqual(process.returncode, 0); self.assertIn('another original batch', process.stderr)

    def test_native_failure_and_answer_provenance_cannot_be_relabelled(self):
        observed = self.sidecars(); group, native = self.groups['q03']; path = observed / group.name / native.name / 'outcome.json'
        self.rewrite(path, lambda v: v.update(state='Complete', failure=None))
        process = self.run_adapter(observed, self.root / 'relabelled')
        self.assertNotEqual(process.returncode, 0); self.assertIn('native state mismatch', process.stderr)
        group, native = self.groups['q01']; path = observed / group.name / native.name / 'answer.json'
        self.rewrite(path, lambda v: v['facts'].update(values=['invented']))
        failed_group, failed_native = self.groups['q03']
        shutil.copy2(failed_native / 'outcome.json', observed / failed_group.name / failed_native.name / 'outcome.json')
        self.rewrite(observed / failed_group.name / failed_native.name / 'outcome.json', lambda v: v.update(originalControllerOutcomeSha256=evaluate.digest(failed_native / 'outcome.json')))
        process = self.run_adapter(observed, self.root / 'different-answer')
        self.assertNotEqual(process.returncode, 0); self.assertIn('answer byte mismatch', process.stderr)

    def test_same_state_failure_rewriting_is_rejected_but_known_normalization_repair_is_preserved(self):
        observed = self.sidecars(); group, native = self.groups['q03']; path = observed / group.name / native.name / 'outcome.json'
        raw = path.read_bytes(); self.rewrite(path, lambda value: value.update(failure=None))
        process = self.run_adapter(observed, self.root / 'deleted-native-failure')
        self.assertNotEqual(process.returncode, 0); self.assertIn('failure lineage', process.stderr)
        path.write_bytes(raw)
        group, native = self.groups['q01']
        self.rewrite(native / 'outcome.json', lambda value: value.update(failure={'type': 'trace-normalization-failed', 'priorFailure': None}, traceComplete=False))
        self.rewrite(group / 'client-exit.json', lambda value: value.update(exit=1))
        shutil.rmtree(observed); observed = self.sidecars()
        self.rewrite(observed / group.name / native.name / 'outcome.json', lambda value: value.update(failure=None, traceComplete=True))
        process = self.run_adapter(observed, self.root / 'known-parser-repair')
        self.assertEqual(process.returncode, 0, process.stderr)
        result = next(item for item in evaluate.load(self.root / 'known-parser-repair/summary.json')['tasks'] if item['taskId'] == 'q01')
        self.assertTrue(result['groundedAnswerSuccessV2']); self.assertEqual(result['originalControllerExit'], 1)
        self.assertEqual(result['originalControllerFailure']['type'], 'trace-normalization-failed')

    def test_lineage_cannot_cause_credential_bytes_to_be_read_and_requires_both_parsers(self):
        observed = self.sidecars(); manifest = observed / 'source-manifest.json'
        self.rewrite(manifest, lambda value: value['originalFiles'].update({str(self.credential): evaluate.digest(self.credential)}))
        original_read = Path.read_bytes; secret_reads = []
        def guarded_read(path):
            if path.resolve() == self.credential.resolve():
                secret_reads.append(str(path)); raise AssertionError('credential bytes read through lineage manifest')
            return original_read(path)
        argv = ['assess_batch.py', '--original', str(self.original), '--observed', str(observed), '--rubric', str(self.rubric), '--out', str(self.root / 'credential-rejected')]
        with patch.object(Path, 'read_bytes', guarded_read), patch.object(sys, 'argv', argv):
            with self.assertRaisesRegex(ValueError, 'unallowlisted'):
                assess_batch.main()
        self.assertEqual(secret_reads, [])
        self.rewrite(manifest, lambda value: value['originalFiles'].pop(str(self.credential)))
        self.rewrite(manifest, lambda value: value.update(parserSources={}))
        process = self.run_adapter(observed, self.root / 'missing-parsers')
        self.assertNotEqual(process.returncode, 0); self.assertIn('parser source set', process.stderr)

    def test_wrong_mode_project_and_missing_scheduled_cell_fail_closed(self):
        group, directory = self.groups['q01']; path = directory / 'trace.jsonl'
        events = [json.loads(line) for line in path.read_text().splitlines()]; events[0]['arguments']['project'] = 'wrong'
        path.write_text(''.join(json.dumps(event) + '\n' for event in events))
        process = self.run_adapter(self.original, self.root / 'wrong-condition-count')
        self.assertNotEqual(process.returncode, 0); self.assertIn('violation count', process.stderr)
        self.rewrite(directory / 'outcome.json', lambda v: v.update(conditionViolations=1))
        process = self.run_adapter(self.original, self.root / 'reported-condition')
        self.assertEqual(process.returncode, 0, process.stderr)
        result = next(item for item in evaluate.load(self.root / 'reported-condition/summary.json')['tasks'] if item['taskId'] == 'q01')
        self.assertFalse(result['groundedAnswerSuccessV2'])
        shutil.rmtree(self.groups['q03'][0])
        process = self.run_adapter(self.original, self.root / 'incomplete-schedule')
        self.assertNotEqual(process.returncode, 0); self.assertIn('complete declared schedule', process.stderr)


if __name__ == '__main__':
    unittest.main()
