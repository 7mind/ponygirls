"""Behavioral-Active Blackbox-Group contracts; explicit criterion-amendment origin."""
import copy
import json
import hashlib
import tempfile
import subprocess
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import evaluate
import proposition_support


class PropositionContracts(unittest.TestCase):
    def setUp(self):
        source = ROOT / 'tests/data/proposition-source-subset.json'
        self.fixture = evaluate.load(source)
        self.sha = evaluate.digest(source)
        self.rubric = evaluate.load(ROOT / 'semantic-propositions.json')
        self.rubric['fixtureSha256'] = self.sha
        self.rubric['tasks'] = {task['id']: self.rubric['tasks'][task['id']] for task in self.fixture['tasks']}
        self.catalog = {doc['id']: {'sessionId': doc['id'], 'view': {'revision': 1, 'generationId': 'g-' + doc['id']}}
                        for doc in self.fixture['documents']}
        self.outcome = {'state': 'Complete', 'failure': None, 'traceComplete': True, 'conditionViolations': 0}
        self.answer_available = True
        self.configure('q01', [('d01', 'last confirmed offset')])

    def configure(self, identity, citations):
        self.task = next(task for task in self.fixture['tasks'] if task['id'] == identity)
        self.outcome['taskId'] = identity
        self.answer = {'taskId': identity, 'facts': copy.deepcopy(self.task['facts']),
                       'abstain': not bool(self.task['evidence']), 'citations': []}
        self.trace = []
        for key, quote in citations:
            document = next(doc for doc in self.fixture['documents'] if doc['id'] == key)
            self.answer['citations'].append({'sessionId': key, 'view': self.catalog[key]['view'], 'messageId': 'm', 'quote': quote})
            self.trace.append({'taskId': identity, 'tool': 'get_messages', 'arguments': {'sessionId': key},
                               'result': {'view': self.catalog[key]['view'], 'messages': evaluate.messages(document)}})

    def legacy(self):
        return evaluate.score_task(self.fixture, self.catalog, self.task, self.answer, self.trace, 5,
                                   principal=self.task['principal'], fact_format=self.fixture['factFormat'])

    def rebind_test_source(self):
        raw = (json.dumps(self.fixture, ensure_ascii=False) + '\n').encode()
        self.sha = hashlib.sha256(raw).hexdigest()
        self.rubric['fixtureSha256'] = self.sha

    def assess(self, principal='reader'):
        return proposition_support.assess(self.fixture, self.catalog, self.task, self.answer, self.trace,
            self.outcome, self.rubric, 5, principal=principal, fixture_sha256=self.sha,
            answer_available=self.answer_available)

    def test_q01_partial_anchor_is_grounded_while_legacy_remains_false(self):
        legacy = evaluate.score_task(self.fixture, self.catalog, self.task, self.answer, self.trace, 5,
                                    principal='reader', fact_format=self.fixture['factFormat'])
        self.assertFalse(legacy['evidenceCoverage'])
        self.assertFalse(legacy['answerSuccess'])
        result = self.assess()
        self.assertTrue(result['groundedAnswerSuccessV2'])
        for key, value in legacy.items():
            self.assertEqual(result[key], value)

    def test_q02_split_citations_support_two_requested_values(self):
        self.configure('q02', [('d03', 'port 4319'), ('d03', '24 concurrent workers')])
        result = self.assess()
        self.assertFalse(result['answerSuccess'])
        self.assertFalse(result['evidenceCoverage'])
        self.assertTrue(result['groundedAnswerSuccessV2'])

    def test_arbitrary_or_non_propositional_quotes_do_not_gain_support(self):
        for quote in ('the', 'Interrupted', 'retransmitting the entire payload is unnecessary'):
            with self.subTest(quote=quote):
                self.configure('q01', [('d01', quote)])
                self.assertEqual(self.legacy()['citationValidity'], 1)
                self.assertTrue(self.legacy()['factMatch'])
                self.assertFalse(self.assess()['groundedAnswerSuccessV2'])

    def test_wrong_source_identity_view_or_unobserved_citation_fails(self):
        for defect in ('source', 'identity', 'view', 'unobserved', 'extra-invalid'):
            with self.subTest(defect=defect):
                self.configure('q01', [('d01', 'last confirmed offset')])
                if defect == 'source':
                    self.configure('q01', [('d02', 'starts a new payload')])
                elif defect == 'identity':
                    self.answer['citations'][0]['messageId'] = 'invented'
                elif defect == 'view':
                    self.answer['citations'][0]['view'] = {'revision': 2, 'generationId': 'stale'}
                elif defect == 'unobserved':
                    self.trace = []
                else:
                    self.answer['citations'].append(dict(self.answer['citations'][0], quote='invented'))
                self.assertFalse(self.assess()['groundedAnswerSuccessV2'])

    def test_observed_source_context_is_required_not_just_quote_or_message(self):
        self.trace[0]['result']['messages'] = [{'id': 'm', 'text': 'last confirmed offset'}]
        self.assertFalse(self.assess()['groundedAnswerSuccessV2'])
        self.configure('q02', [('d03', 'Alder')])
        self.assertEqual(self.legacy()['citationValidity'], 1)
        self.assertTrue(self.legacy()['factMatch'])
        self.assertFalse(self.assess()['groundedAnswerSuccessV2'])

    def test_wrong_units_proposal_and_negation_fail(self):
        self.configure('q11', [('d20', '17 MiB')])
        self.answer['facts']['values'] = ['17 MB']
        self.assertFalse(self.assess()['groundedAnswerSuccessV2'])
        self.configure('q11', [('d21', '17 MB')])
        self.assertFalse(self.assess()['groundedAnswerSuccessV2'])
        self.configure('q09', [('d16', 'copied between regions'), ('d16', 'invalidation events')])
        self.assertEqual(self.legacy()['citationValidity'], 1)
        self.assertTrue(self.legacy()['factMatch'])
        self.assertFalse(self.assess()['groundedAnswerSuccessV2'])
        self.configure('q09', [('d16', 'not copied between regions'), ('d16', 'invalidation events')])
        self.assertTrue(self.assess()['groundedAnswerSuccessV2'])

    def test_wrong_unit_and_rejected_proposal_in_correct_source_are_not_grounding(self):
        document = next(doc for doc in self.fixture['documents'] if doc['id'] == 'd20')
        document['messages'][0]['text'] += ' A rejected proposal used 17 MB.'
        self.rebind_test_source()
        self.configure('q11', [('d20', '17 MB')])
        self.assertEqual(self.legacy()['citationValidity'], 1)
        self.assertTrue(self.legacy()['factMatch'])
        self.assertFalse(self.assess()['groundedAnswerSuccessV2'])
        document = next(doc for doc in self.fixture['documents'] if doc['id'] == 'd03')
        document['messages'][0]['text'] += ' A rejected proposal used port 9412 and 48 concurrent workers.'
        self.rebind_test_source()
        self.configure('q02', [('d03', 'port 9412'), ('d03', '48 concurrent workers')])
        self.assertEqual(self.legacy()['citationValidity'], 1)
        self.assertTrue(self.legacy()['factMatch'])
        self.assertFalse(self.assess()['groundedAnswerSuccessV2'])

    def test_ledger_exact_coverage_and_prefreeze_anchor_boundaries(self):
        ledger = evaluate.load(ROOT / 'semantic-propositions.json')
        self.assertEqual(set(ledger['tasks']), {f'q{index:02d}' for index in range(1, 17)})
        self.assertEqual(sum(bool(entry['propositions']) for entry in ledger['tasks'].values()), 12)
        self.assertEqual(sum(len(entry['propositions']) for entry in ledger['tasks'].values()), 16)
        for task, anchor in {'q04': 'WILLOW-73', 'q05': '21 days', 'q06': 'stale revision is rejected', 'q09': 'not copied'}.items():
            self.assertEqual(ledger['tasks'][task]['propositions'][0]['citationAnchorsAny'], [anchor])

    def test_validation_rejects_hash_coverage_principal_and_source_changes(self):
        original = copy.deepcopy(self.rubric)
        for defect in ('hash', 'missing', 'extra', 'duplicate-slot', 'principal', 'empty-anchor', 'invented-context'):
            with self.subTest(defect=defect):
                self.rubric = copy.deepcopy(original)
                if defect == 'hash':
                    self.rubric['fixtureSha256'] = '0' * 64
                elif defect == 'missing':
                    del self.rubric['tasks']['q03']
                elif defect == 'extra':
                    self.rubric['tasks']['q99'] = {'principal': 'reader', 'propositions': []}
                elif defect == 'duplicate-slot':
                    self.rubric['tasks']['q02']['propositions'][1]['valueIndex'] = 0
                elif defect == 'principal':
                    self.rubric['tasks']['q01']['principal'] = 'restricted'
                elif defect == 'empty-anchor':
                    self.rubric['tasks']['q01']['propositions'][0]['citationAnchorsAny'] = []
                else:
                    self.rubric['tasks']['q01']['propositions'][0]['observedContextAll'] = ['invented']
                with self.assertRaises(ValueError):
                    self.assess()
        self.rubric = original
        with self.assertRaises(ValueError):
            self.assess('restricted')

    def test_two_source_propositions_cannot_borrow_another_sources_citation(self):
        self.configure('q10', [('d18', 'Rina'), ('d19', '04:15 UTC')])
        self.assertTrue(self.assess()['groundedAnswerSuccessV2'])
        document = next(doc for doc in self.fixture['documents'] if doc['id'] == 'd19')
        document['messages'][0]['text'] += ' A staffing note also names Rina.'
        self.rebind_test_source()
        self.configure('q10', [('d19', 'Rina'), ('d19', '04:15 UTC')])
        other = next(doc for doc in self.fixture['documents'] if doc['id'] == 'd18')
        self.trace.append({'taskId': 'q10', 'tool': 'get_messages', 'arguments': {'sessionId': 'd18'},
                           'result': {'view': self.catalog['d18']['view'], 'messages': evaluate.messages(other)}})
        self.assertEqual(self.legacy()['citationValidity'], 1)
        self.assertTrue(self.legacy()['factMatch'])
        result = self.assess()
        self.assertFalse(result['groundedAnswerSuccessV2'])
        self.assertFalse(result['propositionSupport'][0]['supported'])
        self.assertTrue(result['propositionSupport'][0]['contextObservedInTraceIndices'])

    def test_owner_positive_and_acl_negative_remain_distinct(self):
        self.configure('q12', [('d22', 'HEATHER-86')])
        result = self.assess('restricted')
        self.assertFalse(result['aclLeak'])
        self.assertTrue(result['groundedAnswerSuccessV2'])
        self.configure('q13', [])
        self.assertTrue(self.assess()['groundedAnswerSuccessV2'])
        private = next(doc for doc in self.fixture['documents'] if doc['id'] == 'd22')
        self.trace = [{'taskId': 'q13', 'tool': 'get_messages', 'arguments': {'sessionId': 'd22'},
                       'result': {'view': self.catalog['d22']['view'], 'messages': evaluate.messages(private)}}]
        result = self.assess()
        self.assertTrue(result['aclLeak'])
        self.assertFalse(result['groundedAnswerSuccessV2'])

    def test_duplicate_rubric_json_fields_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'rubric.json'; path.write_text('{"tasks":{},"tasks":{}}')
            with self.assertRaisesRegex(ValueError, 'duplicate rubric JSON field'):
                proposition_support.load_rubric(path)

    def test_alias_matching_is_unchanged(self):
        self.configure('q02', [('d03', 'port 4319'), ('d03', '24 concurrent workers')])
        self.answer['facts']['values'] = ['PORT 4319', ' 24   workers ']
        self.assertTrue(self.assess()['groundedAnswerSuccessV2'])
        self.answer['facts']['values'].reverse()
        self.assertFalse(self.assess()['groundedAnswerSuccessV2'])

    def test_native_failure_availability_trace_and_condition_gates(self):
        for defect in ('native', 'failure', 'trace', 'conditions', 'answer'):
            with self.subTest(defect=defect):
                self.outcome = {'taskId': self.task['id'], 'state': 'Complete', 'failure': None, 'traceComplete': True, 'conditionViolations': 0}
                self.answer_available = True
                if defect == 'native':
                    self.outcome.update(state='Failed', failure={'code': 'mcp-context-limit'})
                elif defect == 'failure':
                    self.outcome['failure'] = {'type': 'trace-normalization-failed'}
                elif defect == 'trace':
                    self.outcome['traceComplete'] = False
                elif defect == 'conditions':
                    self.outcome['conditionViolations'] = 1
                else:
                    self.answer_available = False
                self.assertFalse(self.assess()['groundedAnswerSuccessV2'])

    def test_correct_abstention_still_requires_successful_execution(self):
        self.configure('q03', [])
        self.assertTrue(self.assess()['groundedAnswerSuccessV2'])
        self.outcome.update(state='Failed', failure={'code': 'mcp-context-limit'})
        self.answer_available = False
        self.assertTrue(self.legacy()['factMatch'])
        self.assertTrue(self.legacy()['answerSuccess'])
        self.assertFalse(self.assess()['groundedAnswerSuccessV2'])

    def cli_inputs(self, directory):
        files = {'fixture': self.fixture, 'catalog': {'fixtureSha256': self.sha, 'documents': self.catalog},
                 'answer': self.answer, 'outcome': self.outcome, 'rubric': self.rubric}
        paths = {}
        for name, value in files.items():
            path = directory / (name + '.json'); path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
            paths[name] = path
        # The fixture's actual bytes, not canonicalized JSON, are the binding.
        self.sha = evaluate.digest(paths['fixture'])
        files['catalog']['fixtureSha256'] = self.sha; files['rubric']['fixtureSha256'] = self.sha
        for name in ('catalog', 'rubric'):
            paths[name].write_text(json.dumps(files[name], indent=2, ensure_ascii=False) + '\n')
        paths['trace'] = directory / 'trace.jsonl'
        paths['trace'].write_text(''.join(json.dumps(event) + '\n' for event in self.trace))
        command = [sys.executable, str(ROOT / 'proposition_support.py')]
        for name, path in paths.items():
            command += ['--' + name, str(path)]
        return command + ['--principal', 'reader', '--k', '5', '--out', str(directory / 'score.json')], paths

    def test_cli_requires_availability_and_preserves_exact_fixture_byte_binding(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary); command, paths = self.cli_inputs(directory)
            missing = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn('--answer-available', missing.stderr)
            completed = subprocess.run(command + ['--answer-available', 'yes'], capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            result = evaluate.load(directory / 'score.json')
            self.assertTrue(result['groundedAnswerSuccessV2'])
            self.assertFalse(result['answerSuccess'])
            self.assertEqual(result['inputs']['fixture'], evaluate.digest(paths['fixture']))
            self.assertEqual(result['propositionSupport'][0]['supportingCitationIndices'], [0])
            paths['fixture'].write_text(paths['fixture'].read_text() + ' ')
            mismatch = subprocess.run(command + ['--answer-available', 'yes'], capture_output=True, text=True)
            self.assertNotEqual(mismatch.returncode, 0)
            self.assertIn('hash mismatch', mismatch.stderr)

    def test_cli_rejects_unprojected_outcome_and_wrong_principal(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary); command, paths = self.cli_inputs(directory)
            outcome = evaluate.load(paths['outcome']); outcome['taskId'] = 'different-id'
            paths['outcome'].write_text(json.dumps(outcome))
            mismatch = subprocess.run(command + ['--answer-available', 'yes'], capture_output=True, text=True)
            self.assertNotEqual(mismatch.returncode, 0)
            self.assertIn('identity mismatch', mismatch.stderr)
            self.outcome['taskId'] = self.task['id']; paths['outcome'].write_text(json.dumps(self.outcome))
            command[command.index('--principal') + 1] = 'restricted'
            mismatch = subprocess.run(command + ['--answer-available', 'yes'], capture_output=True, text=True)
            self.assertNotEqual(mismatch.returncode, 0)
            self.assertIn('principal mismatch', mismatch.stderr)


if __name__ == '__main__':
    unittest.main()
