"""Specified Behavioral-Active/Blackbox-Group; frozen synthetic artifacts, no provider."""
from dataclasses import replace
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from assessment_v3 import BoundArtifact, assess_cell, sha256
from source_observations_v3 import EvidenceIntegrityError
from v3_cases import artifact, cell, chunk, context, required, search, whole, with_review


class AssessmentContract(unittest.TestCase):
    def test_no_review_is_unavailable_not_alias_truth(self):
        result = assess_cell(cell())
        self.assertTrue(result['output']['literalAliasValueConformance'])
        self.assertFalse(result['review']['available'])
        self.assertIsNone(result['review']['factualCorrect'])
        self.assertIsNone(result['evidence']['allPropositionsSupported'])
        self.assertFalse(result['groundedAnswerSuccessV3'])
        self.assertEqual(result['navigation']['firstRubricEvidenceAvailableTraceIndex'], 1)
        self.assertIsNone(result['legacyMetrics']['strict'])

    def test_reviewed_current_fact_with_qualifier_and_usability_gate(self):
        result = assess_cell(with_review(cell()))
        self.assertTrue(result['groundedAnswerSuccessV3'])
        self.assertTrue(result['navigation']['searchContextCorrectCitationWithQualifier'])
        self.assertEqual(result['navigation']['postEvidenceOperations'], 0)
        self.assertTrue(result['evidence']['allCitationsValid'])
        self.assertEqual(result['evidence']['citationProvenance'][0][0]['view']['revision'], 1)

    def test_literal_snippet_can_suffice_without_extra_tool_proxy(self):
        result = assess_cell(with_review(cell([search(chunk('Approved 4319', 0))])))
        self.assertTrue(result['groundedAnswerSuccessV3'])
        self.assertEqual(result['navigation']['firstRubricEvidenceAvailableTraceIndex'], 0)
        self.assertFalse(result['navigation']['searchContextCorrectCitationWithQualifier'])

    def test_accurate_rejected_contrast_cannot_replace_positive_fact(self):
        rejected = search(chunk('Rejected 4319', 0))
        result = assess_cell(with_review(cell([rejected]), role='rejected-contrast'))
        self.assertTrue(result['evidence']['allCitationsValid'])
        self.assertFalse(result['evidence']['propositions'][0]['supported'])
        self.assertFalse(result['groundedAnswerSuccessV3'])

    def test_same_quote_rejected_occurrence_not_approved_even_if_qualifier_seen(self):
        rejected = search(chunk('4319', 0)); qualifier = search(chunk('Approved', 0))
        result = assess_cell(with_review(cell([rejected, qualifier])))
        self.assertTrue(result['evidence']['allCitationsValid'])
        self.assertEqual(result['evidence']['propositions'][0]['sourceValidAnchorCitationIndices'], [])
        self.assertFalse(result['groundedAnswerSuccessV3'])

    def test_qualifier_can_be_observed_in_separate_valid_slice(self):
        result = assess_cell(with_review(cell([search(), search(chunk('Approved', 0))])))
        self.assertTrue(result['groundedAnswerSuccessV3'])
        self.assertEqual(result['navigation']['firstRubricEvidenceAvailableTraceIndex'], 1)

    def test_negation_qualifier_not_invented_from_positive_substring(self):
        inputs = cell([search(chunk('cache entries are ', 0)), search(chunk('copied', 0))])
        rubric = inputs.rubric.json(); prop = rubric['tasks']['q1']['propositions'][0]
        prop['anchorsAny'] = [required('copied')]; prop['qualifiersAll'] = [required('not ')]
        prop['factualCriteria'] = 'Cache entries are not copied (negative polarity).'
        answer = inputs.answer.json(); answer['citations'][0]['quote'] = 'copied'
        inputs = replace(inputs, rubric=artifact(rubric), answer=artifact(answer))
        result = assess_cell(with_review(inputs))
        self.assertTrue(result['evidence']['allCitationsValid'])
        self.assertIsNone(result['navigation']['firstRubricEvidenceAvailableTraceIndex'])
        self.assertFalse(result['groundedAnswerSuccessV3'])

    def test_wrong_units_or_polarity_can_fail_review_despite_alias_match(self):
        result = assess_cell(with_review(cell(), correct=False))
        self.assertTrue(result['output']['literalAliasValueConformance'])
        self.assertFalse(result['review']['factualCorrect'])
        self.assertFalse(result['groundedAnswerSuccessV3'])

    def test_reviewed_semantics_are_not_replaced_by_aliases(self):
        inputs = cell(); answer = inputs.answer.json(); answer['facts']['values'] = ['TCP port 4319']
        result = assess_cell(with_review(replace(inputs, answer=artifact(answer))))
        self.assertFalse(result['output']['literalAliasValueConformance'])
        self.assertTrue(result['groundedAnswerSuccessV3'])

    def test_missing_answer_and_incomplete_trace_preserve_outcomes_without_placeholder(self):
        inputs = cell(); outcome = inputs.outcome.json(); outcome.update(state='Failed', failure={'type': 'deadline'}, traceComplete=False)
        result = assess_cell(replace(inputs, native_outcome=artifact(outcome), outcome=artifact(outcome), answer=None, controller=artifact({'exit': 1})))
        self.assertFalse(result['execution']['answerAvailable'])
        self.assertFalse(result['execution']['eligible'])
        self.assertFalse(result['evidence']['available'])
        self.assertIsNone(result['evidence']['citationProvenance'])
        self.assertIsNone(result['output']['literalAliasValueConformance'])
        self.assertEqual(result['execution']['nativeOutcome']['failure'], {'type': 'deadline'})
        self.assertFalse(result['groundedAnswerSuccessV3'])

    def test_incomplete_trace_has_no_evidence_success_even_with_answer(self):
        inputs = cell(); outcome = inputs.outcome.json(); outcome['traceComplete'] = False
        inputs = replace(inputs, outcome=artifact(outcome))
        result = assess_cell(with_review(inputs))
        self.assertIsNone(result['evidence']['allCitationsValid'])
        self.assertFalse(result['groundedAnswerSuccessV3'])

    def test_invalid_recognized_payload_is_cell_integrity_failure_not_ignored(self):
        event = context(); event['result']['excerpts'][0]['text'] = 'Approved 9999'
        result = assess_cell(with_review(cell([search(), event])))
        self.assertFalse(result['evidence']['available'])
        self.assertIn('source text/range mismatch', result['evidence']['integrityFailure'])
        self.assertFalse(result['groundedAnswerSuccessV3'])

    def test_disagreement_requires_recorded_adjudication(self):
        inputs = with_review(cell()); manifest = inputs.review.json()
        record = copy.deepcopy(manifest['reviews'][0]); record['reviewId'] = 'r2'; record['factualCorrect'] = False
        manifest['reviews'].append(record)
        result = assess_cell(replace(inputs, review=artifact(manifest)))
        self.assertFalse(result['review']['available'])
        adjudication = copy.deepcopy(manifest['reviews'][0]); adjudication.update(reviewId='root-r1', reviewerKind='root-adjudication', resolvesReviewIds=['r1', 'r2'])
        manifest['adjudication'] = adjudication
        self.assertTrue(assess_cell(replace(inputs, review=artifact(manifest)))['groundedAnswerSuccessV3'])

    def test_catalog_fixture_schedule_opaque_prompt_question_and_hash_bindings(self):
        inputs = cell()
        altered_catalog = inputs.catalog.json(); altered_catalog['fixtureSha256'] = 'f' * 64
        config = inputs.configuration.json(); config['tasks'][0]['question'] = 'Another question?'
        for patch in [dict(catalog=artifact(altered_catalog)), dict(schedule=artifact({'trials': []})),
                      dict(opaque_id='other'), dict(expected_prompt_sha256='f' * 64), dict(configuration=artifact(config)),
                      dict(fixture=BoundArtifact(inputs.fixture.raw + b' ', inputs.fixture.expected_sha256))]:
            with self.subTest(patch=list(patch)), self.assertRaises((EvidenceIntegrityError, KeyError)):
                assess_cell(replace(inputs, **patch))

    def test_condition_violations_are_separate_and_gate_success(self):
        inputs = cell(); trace = inputs.trace.jsonl(); trace[0]['arguments']['mode'] = 'semantic'
        outcome = inputs.outcome.json(); outcome['conditionViolations'] = 1
        inputs = replace(inputs, trace=artifact(trace, jsonl=True), outcome=artifact(outcome))
        result = assess_cell(with_review(inputs))
        self.assertTrue(result['evidence']['allCitationsValid'])
        self.assertEqual(result['conditions']['violationTraceIndices'], [0])
        self.assertFalse(result['groundedAnswerSuccessV3'])

    def test_post_evidence_operations_are_observable_not_cognition(self):
        inputs = cell([search(), context(), search()])
        result = assess_cell(with_review(inputs))
        self.assertEqual(result['navigation']['postEvidenceOperations'], 1)
        self.assertIn('not model cognition', result['navigation']['availabilityMeaning'])

    def test_versioned_cli_reads_bound_artifacts_and_creates_fresh_output(self):
        inputs = with_review(cell())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); artifacts = {}
            for name in inputs.__dataclass_fields__:
                value = getattr(inputs, name)
                if isinstance(value, BoundArtifact):
                    path = root / name; path.write_bytes(value.raw)
                    artifacts[name] = {'path': str(path), 'sha256': value.expected_sha256}
                elif value is None:
                    artifacts[name] = None
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'taskId': 'q1', 'opaqueId': 'opaque', 'expectedPromptSha256': inputs.expected_prompt_sha256, 'artifacts': artifacts}))
            result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'assessment_v3.py'), '--manifest', str(manifest), '--out', str(root / 'out.json')], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(json.loads((root / 'out.json').read_text())['groundedAnswerSuccessV3'])

    def test_incomplete_trace_proposition_verdict_is_unavailable(self):
        inputs = cell(); outcome = inputs.outcome.json(); outcome['traceComplete'] = False
        result = assess_cell(with_review(replace(inputs, outcome=artifact(outcome))))
        self.assertIsNone(result['evidence']['propositions'][0]['supported'])

    def test_extra_ordered_slot_prevents_output_contract_success(self):
        inputs = cell(); answer = inputs.answer.json(); answer['facts']['values'].append('unrequested value')
        result = assess_cell(with_review(replace(inputs, answer=artifact(answer))))
        self.assertFalse(result['output']['orderedSlotsConform'])
        self.assertFalse(result['groundedAnswerSuccessV3'])

    def test_reviewed_negative_requires_real_abstention_answer_not_placeholder(self):
        inputs = cell([]); fixture = inputs.fixture.json(); task = fixture['tasks'][0]
        task['facts']['values'] = []; task['factAliases'] = []; task['evidence'] = []; task['relevant'] = []
        fixture = artifact(fixture); catalog = inputs.catalog.json(); catalog['fixtureSha256'] = fixture.expected_sha256
        rubric = inputs.rubric.json(); rubric['fixtureSha256'] = fixture.expected_sha256; rubric['tasks']['q1']['propositions'] = []
        answer = inputs.answer.json(); answer.update(facts={'values': []}, abstain=True, citations=[])
        inputs = with_review(replace(inputs, fixture=fixture, catalog=artifact(catalog), rubric=artifact(rubric), answer=artifact(answer)))
        review = inputs.review.json(); review['reviews'][0]['citationRoles'] = []
        result = assess_cell(replace(inputs, review=artifact(review)))
        self.assertTrue(result['groundedAnswerSuccessV3'])
        self.assertIsNone(result['navigation']['firstRubricEvidenceAvailableTraceIndex'])

    def test_acl_leak_is_reported_separately_from_integrity_failure(self):
        inputs = cell(); fixture = inputs.fixture.json()
        fixture['documents'].append({'id': 'private', 'principal': 'other', 'messages': [{'id': 'secret', 'text': 'private'}]})
        fixture = artifact(fixture); catalog = inputs.catalog.json(); catalog['fixtureSha256'] = fixture.expected_sha256
        catalog['documents']['private'] = {'sessionId': 'private-session', 'view': catalog['documents']['decision']['view']}
        rubric = inputs.rubric.json(); rubric['fixtureSha256'] = fixture.expected_sha256
        trace = inputs.trace.jsonl(); private_event = search(); private_event['result']['hits'][0]['session']['id'] = 'private-session'
        trace.append(private_event)
        inputs = replace(inputs, fixture=fixture, catalog=artifact(catalog), rubric=artifact(rubric), trace=artifact(trace, jsonl=True))
        result = assess_cell(with_review(inputs))
        self.assertTrue(result['conditions']['aclLeak'])
        self.assertFalse(result['evidence']['available'])
        self.assertFalse(result['groundedAnswerSuccessV3'])

    def test_malformed_recognized_session_payload_is_integrity_failure_not_crash(self):
        event = {'taskId': 'opaque', 'tool': 'get_session', 'arguments': {'sessionId': [], 'view': {}}, 'result': {'session': None}}
        result = assess_cell(with_review(cell([event])))
        self.assertFalse(result['evidence']['available'])
        self.assertIsNotNone(result['evidence']['integrityFailure'])
        self.assertFalse(result['conditions']['aclObservationComplete'])

    def test_review_citation_index_is_integer_not_boolean_alias(self):
        inputs = with_review(cell()); review = inputs.review.json(); review['reviews'][0]['citationRoles'][0]['citationIndex'] = False
        with self.assertRaises(EvidenceIntegrityError): assess_cell(replace(inputs, review=artifact(review)))

    def test_global_schedule_uses_exact_discriminator_without_prompt_metadata(self):
        inputs = cell(); first = {'batchId': 'a', 'arm': 'baseline', 'repeat': 1, 'mode': 'lexical', 'taskId': 'q1', 'ordinal': 0}
        second = {**first, 'batchId': 'b', 'arm': 'context', 'ordinal': 1}
        run = inputs.run.json(); run['scheduleCell'] = first
        inputs = replace(inputs, run=artifact(run), schedule=artifact({'trials': [first, second]}))
        self.assertTrue(assess_cell(with_review(inputs))['groundedAnswerSuccessV3'])
        run['scheduleCell'] = {**first, 'ordinal': 99}
        with self.assertRaises(EvidenceIntegrityError): assess_cell(replace(inputs, run=artifact(run)))
        run.pop('scheduleCell')
        with self.assertRaises(EvidenceIntegrityError): assess_cell(replace(inputs, run=artifact(run)))

    def test_mode_specific_fixed_query_is_explicitly_bound_and_reported(self):
        inputs = cell(); fixture = inputs.fixture.json(); fixture['fixedQueryPolicy'] = 'lexical-curated-keywords-semantic-hybrid-natural-question-v1'
        fixture['tasks'][0]['fixedQueries'] = {'lexical': 'approved port', 'semantic': 'Which approved port?', 'hybrid': 'Which approved port?'}
        fixture = artifact(fixture); rubric = inputs.rubric.json(); rubric['fixtureSha256'] = fixture.expected_sha256
        catalog = inputs.catalog.json(); catalog['fixtureSha256'] = fixture.expected_sha256
        wrapper = {'request': {'query': 'approved port', 'mode': 'lexical', 'project': 'p', 'limit': 5, 'offset': 0}, 'result': inputs.fixed_retrieval.json()}
        inputs = replace(inputs, fixture=fixture, catalog=artifact(catalog), rubric=artifact(rubric), fixed_retrieval=artifact(wrapper))
        result = assess_cell(with_review(inputs))
        self.assertEqual(result['navigation'].get('fixedQueryRequest'), wrapper['request'])
        self.assertEqual(result['navigation'].get('fixedQueryPolicy'), 'lexical-curated-keywords-semantic-hybrid-natural-question-v1')
        wrapper['request']['query'] = 'Which approved port?'
        with self.assertRaises(EvidenceIntegrityError): assess_cell(replace(inputs, fixed_retrieval=artifact(wrapper)))

    def test_controller_failure_gates_execution_without_rewriting_native_completion(self):
        result = assess_cell(with_review(replace(cell(), controller=artifact({'exit': 17, 'failure': 'browser cleanup failed'}))))
        self.assertFalse(result['execution']['eligible'])
        self.assertTrue(result['execution'].get('nativeEligible'))
        self.assertEqual(result['execution']['nativeOutcome']['state'], 'Complete')
        self.assertEqual(result['execution']['controllerOutcome']['exit'], 17)
        self.assertFalse(result['groundedAnswerSuccessV3'])

    def test_extra_contradictory_irrelevant_or_unassigned_requested_citation_fails_role_conformance(self):
        for role, proposition_ids in [('contradictory', []), ('irrelevant', []), ('requested-fact', [])]:
            with self.subTest(role=role):
                inputs = cell(); answer = inputs.answer.json(); answer['citations'].append(copy.deepcopy(answer['citations'][0]))
                inputs = with_review(replace(inputs, answer=artifact(answer)))
                review = inputs.review.json(); review['reviews'][0]['citationRoles'].append({
                    'citationIndex': 1, 'role': role, 'propositionIds': proposition_ids,
                    'rationale': 'Extra valid-source quote does not support a requested proposition.'})
                result = assess_cell(replace(inputs, review=artifact(review)))
                self.assertTrue(result['evidence']['allCitationsValid'])
                self.assertTrue(result['review']['factualCorrect'])
                self.assertTrue(result['evidence']['propositions'][0]['supported'])
                self.assertFalse(result['groundedAnswerSuccessV3'])
                self.assertIs(result['review'].get('citationRoleConformance'), False)

    def test_accurately_attributed_rejected_extra_contrast_remains_role_conforming(self):
        inputs = cell([whole()]); answer = inputs.answer.json()
        contrast = copy.deepcopy(answer['citations'][0]); contrast['quote'] = 'Rejected 4319'; answer['citations'].append(contrast)
        inputs = with_review(replace(inputs, answer=artifact(answer)))
        review = inputs.review.json(); review['reviews'][0]['citationRoles'].append({
            'citationIndex': 1, 'role': 'rejected-contrast', 'propositionIds': [],
            'rationale': 'Accurately attributed rejected proposal; not support for approved port.'})
        result = assess_cell(replace(inputs, review=artifact(review)))
        self.assertTrue(result['evidence']['allCitationsValid'])
        self.assertTrue(result['review']['citationRoleConformance'])
        self.assertEqual(result['evidence']['propositions'][0]['requestedFactCitationIndices'], [0])
        self.assertTrue(result['groundedAnswerSuccessV3'])
