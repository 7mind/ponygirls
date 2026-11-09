"""Specified stable-identity and incremental-frontier controls, not live semantics."""
from dataclasses import asdict
import unittest

from deltas import DeltaError, apply_delta, initial_head, incremental_request
from evidence import Artifacts, HostEvidence, MemoryBytes, Scope
from legacy_domain import Event


def source(ordinal, kind, actor, role):
    return Event('e' + str(ordinal).zfill(6), ordinal, actor, role,
                 'worker-session', 'main', 'P01', kind, 'captured source', True, 'a' * 64)


def node(identity, kind, refs):
    return {'id': identity, 'kind': kind, 'intent': 'explicit' if kind == 'constraint' else 'none',
            'priority': 'none', 'standing': 'active', 'work_state': None,
            'text': 'Attributed account', 'sources': refs, 'change_reason': 'initial',
            'fact_refs': [], 'digest_assertions': []}


def relation(identity, start, end):
    return {'id': identity, 'kind': 'supports', 'standing': 'active',
            'source': start, 'target': end, 'sources': ['e000001']}


class DeltaContract(unittest.TestCase):
    def setUp(self):
        self.scope = Scope('trial-fictional', 'main', 1)
        self.evidence = HostEvidence(self.scope)
        self.events = (source(1, 'scenario_request', 'fixture_injector', 'human'),)
        self.empty = initial_head(self.scope, 'worker-session')
        self.first = self.frame(0, ['e000001'], [node('requirement', 'constraint', ['e000001'])], [])
        self.head = apply_delta(self.empty, self.first, self.events, self.evidence)

    def frame(self, revision, ids, nodes, relations):
        return {'scope': asdict(self.scope), 'base_revision': revision,
                'reviewed_new_event_ids': ids, 'nodes': nodes, 'relations': relations}

    def more(self):
        return self.events + (source(2, 'worker_message', 'participant_worker', 'none'),)

    def test_omission_keeps_prior_intent_and_ids(self):
        head = apply_delta(self.head, self.frame(1, ['e000002'], [], []), self.more(), self.evidence)
        self.assertEqual(head.graph.nodes, self.head.graph.nodes)
        self.assertEqual(head.graph.reviewed_event_ids, ('e000001', 'e000002'))
        self.assertEqual(head.revision, 2)

    def test_failed_delta_does_not_advance_head_or_consume_events(self):
        before = self.head
        bad = self.frame(1, ['e000002'], [], [relation('broken', 'absent', 'requirement')])
        with self.assertRaises(DeltaError):
            apply_delta(before, bad, self.more(), self.evidence)
        self.assertEqual(before.revision, 1)
        request = incremental_request(before, self.more(), self.evidence)
        self.assertEqual([event['id'] for event in request['new_events']], ['e000002'])
        self.assertEqual(request['source_index'][0]['id'], 'e000001')
        self.assertNotIn('text', request['source_index'][0])

    def test_failed_frontiers_do_not_omit_unreviewed_tail(self):
        events = self.more() + (source(3, 'worker_message', 'participant_worker', 'none'),)
        bad = self.frame(1, ['e000003'], [], [])
        with self.assertRaisesRegex(DeltaError, 'new-event-coverage'):
            apply_delta(self.head, bad, events, self.evidence)
        request = incremental_request(self.head, events, self.evidence)
        self.assertEqual([event['id'] for event in request['new_events']], ['e000002', 'e000003'])

    def test_same_frontier_retry_refused(self):
        with self.assertRaisesRegex(DeltaError, 'no-new-frontier'):
            apply_delta(self.head, self.frame(1, [], [], []), self.events, self.evidence)

    def test_exact_base_revision_scope_and_type(self):
        for revision in (False, True, 1.0, 0, 2):
            with self.subTest(revision=revision), self.assertRaises(DeltaError):
                apply_delta(self.head, self.frame(revision, ['e000002'], [], []), self.more(), self.evidence)
        wrong = self.frame(1, ['e000002'], [], [])
        wrong['scope']['trial_id'] = 'foreign'
        with self.assertRaisesRegex(DeltaError, 'scope'):
            apply_delta(self.head, wrong, self.more(), self.evidence)

    def test_existing_source_bytes_cannot_change_under_same_id(self):
        from dataclasses import replace
        events = (replace(self.events[0], text='different source bytes'), self.more()[1])
        with self.assertRaisesRegex(DeltaError, 'source-prefix-identity'):
            apply_delta(self.head, self.frame(1, ['e000002'], [], []), events, self.evidence)

    def test_execution_fact_is_not_a_file_digest_operand(self):
        events = self.events + (source(2, 'tool_observation', 'owned_tool_dispatcher', 'none'),)
        proof = self.evidence.observe_execution('e000002', 'contract', 1, 'run_tests',
                    ('python3',), 'a' * 64, (), 'completed', 0, 'b' * 64)
        record = node('observation', 'observation', ['e000002'])
        record['fact_refs'] = [asdict(proof.reference)]
        record['digest_assertions'] = [{'reference': asdict(proof.reference), 'expected_sha256': '0' * 64}]
        with self.assertRaisesRegex(DeltaError, 'predicate-fact-kind'):
            apply_delta(self.head, self.frame(1, ['e000002'], [record], []), events, self.evidence)

    def test_foreign_source_branch_is_not_a_local_new_event(self):
        from dataclasses import replace
        events = (self.events[0], replace(self.more()[1], branch_id='foreign'))
        with self.assertRaisesRegex(DeltaError, 'source-scope'):
            apply_delta(self.head, self.frame(1, ['e000002'], [], []), events, self.evidence)

    def test_foreign_source_session_is_not_a_local_new_event(self):
        from dataclasses import replace
        events = (self.events[0], replace(self.more()[1], session_id='foreign'))
        with self.assertRaisesRegex(DeltaError, 'source-scope'):
            apply_delta(self.head, self.frame(1, ['e000002'], [], []), events, self.evidence)

    def test_prior_prefix_cannot_be_replaced(self):
        events = (source(2, 'scenario_request', 'fixture_injector', 'human'),)
        with self.assertRaisesRegex(DeltaError, 'source-prefix'):
            apply_delta(self.head, self.frame(1, [], [], []), events, self.evidence)

    def test_node_retirement_is_explicit_not_deletion(self):
        changed = node('requirement', 'constraint', ['e000001', 'e000002'])
        changed['standing'] = 'withdrawn'; changed['change_reason'] = 'reinterpretation'
        updated = apply_delta(self.head, self.frame(1, ['e000002'], [changed], []), self.more(), self.evidence)
        self.assertEqual(updated.graph.nodes[0].standing, 'withdrawn')
        self.assertEqual(self.head.graph.nodes[0].standing, 'active')
        bad = self.frame(1, ['e000002'], [], []); bad['delete_nodes'] = ['requirement']
        with self.assertRaises(DeltaError):
            apply_delta(self.head, bad, self.more(), self.evidence)

    def test_relation_rename_cannot_drop_or_duplicate_prior_identity(self):
        observations = node('observation', 'observation', ['e000001'])
        head = apply_delta(self.empty, self.frame(0, ['e000001'], self.first['nodes'] + [observations], [relation('stable', 'observation', 'requirement')]), self.events, self.evidence)
        renamed = self.frame(1, ['e000002'], [], [relation('renamed', 'observation', 'requirement')])
        with self.assertRaisesRegex(DeltaError, 'relation-proposition-already-named'):
            apply_delta(head, renamed, self.more(), self.evidence)
        self.assertEqual([r.id for r in head.graph.relations], ['stable'])

    def test_relation_endpoint_repurposing_refused(self):
        observation = node('observation', 'observation', ['e000001'])
        head = apply_delta(self.empty, self.frame(0, ['e000001'], self.first['nodes'] + [observation], [relation('stable', 'observation', 'requirement')]), self.events, self.evidence)
        repurposed = relation('stable', 'requirement', 'observation')
        with self.assertRaisesRegex(DeltaError, 'relation-identity-repurposed'):
            apply_delta(head, self.frame(1, ['e000002'], [], [repurposed]), self.more(), self.evidence)

    def test_duplicate_updates_refuse_whole_delta(self):
        for key, values in [('nodes', self.first['nodes'] * 2), ('relations', [relation('same', 'requirement', 'other')] * 2)]:
            raw = self.frame(1, ['e000002'], [], []); raw[key] = values
            with self.subTest(key=key), self.assertRaisesRegex(DeltaError, 'duplicate'):
                apply_delta(self.head, raw, self.more(), self.evidence)
        self.assertEqual(self.head.revision, 1)

    def test_curator_cannot_supply_host_fact_values(self):
        raw = self.frame(1, ['e000002'], [], []); raw['host_facts'] = [{'sha256': '0' * 64}]
        with self.assertRaises(DeltaError):
            apply_delta(self.head, raw, self.more(), self.evidence)

    def fact_scenario(self):
        events = self.events + (source(2, 'tool_observation', 'owned_tool_dispatcher', 'none'),)
        artifact = Artifacts(MemoryBytes(), self.evidence, ('solution.py',))
        fact = artifact.write('e000002', 'solution.py', b'actual\n')
        record = node('observation', 'observation', ['e000002'])
        record['fact_refs'] = [asdict(fact.reference)]
        return events, fact, record

    def test_actual_fact_reference_is_bound_without_verifying_prose(self):
        events, fact, record = self.fact_scenario()
        record['digest_assertions'] = [{'reference': asdict(fact.reference), 'expected_sha256': '0' * 64}]
        result = apply_delta(self.head, self.frame(1, ['e000002'], [record], []), events, self.evidence)
        annotation = next(item for item in result.assertions if item.identity == 'observation')
        self.assertEqual(annotation.digest_assertions[0].expected_sha256, '0' * 64)
        self.assertEqual(self.evidence.resolve(fact.reference), fact)

    def test_unknown_or_foreign_fact_ref_refuses(self):
        events, fact, record = self.fact_scenario()
        for key, value in [('fact_id', 'missing'), ('scope', asdict(Scope('foreign', 'main', 1)))]:
            from copy import deepcopy
            changed = deepcopy(record); changed['fact_refs'][0][key] = value
            with self.subTest(key=key), self.assertRaises(DeltaError):
                apply_delta(self.head, self.frame(1, ['e000002'], [changed], []), events, self.evidence)

    def test_fact_event_must_be_in_the_node_source_basis(self):
        events, fact, record = self.fact_scenario()
        record['sources'] = ['e000001']
        with self.assertRaisesRegex(DeltaError, 'fact-source-not-cited'):
            apply_delta(self.head, self.frame(1, ['e000002'], [record], []), events, self.evidence)

    def test_future_fact_or_replay_is_not_eligible_observation_basis(self):
        events, fact, record = self.fact_scenario()
        events = (events[0], source(2, 'derived_context_result', 'owned_tool_dispatcher', 'none'))
        with self.assertRaisesRegex(DeltaError, 'fact-source-kind'):
            apply_delta(self.head, self.frame(1, ['e000002'], [record], []), events, self.evidence)


if __name__ == '__main__':
    unittest.main()
