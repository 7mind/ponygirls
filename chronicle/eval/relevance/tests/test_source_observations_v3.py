"""Specified Behavioral-Active/Blackbox-Group: actual wire + frozen fixture bytes."""
import copy
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from source_observations_v3 import (EvidenceIntegrityError, FrozenSources, View, citation_occurrences, observe_trace, scalar_range, utf8)
from v3_cases import SID, VIEW, NORMALIZED, artifact, byte_range, cell, chunk, context, search, whole


class SourceContract(unittest.TestCase):
    def setUp(self):
        self.inputs = cell()
        self.sources = FrozenSources.from_fixture(self.inputs.fixture.json(), self.inputs.catalog.json()['documents'], 'reader')

    def observe(self, *events):
        return observe_trace('opaque', events, self.sources)

    def citation(self, quote):
        return {'sessionId': SID, 'view': VIEW, 'messageId': 'm', 'quote': quote}

    def test_whole_message_uses_page_ordinal_not_record_index_and_normalizes_nul(self):
        observed = self.observe(whole()).observations[0]
        self.assertEqual(observed.message_position, 2)
        self.assertEqual(observed.start, 0)
        self.assertEqual(observed.end, len(utf8(NORMALIZED)))
        self.assertEqual(observed.role, 'assistant')
        self.assertNotIn('\x00', observed.text)
        self.assertEqual(observed.kind, 'whole-message')

    def test_context_keeps_explicit_utf8_ranges_and_role(self):
        observed = self.observe(context()).observations[0]
        self.assertEqual(observed.text, 'Approved 4319')
        self.assertEqual(observed.kind, 'context-excerpt')
        self.assertGreater(observed.start, 0)
        self.assertEqual(observed.end - observed.start, len(utf8(observed.text)))

    def test_search_chunks_session_literal_only(self):
        event = search(chunk('Approved 4319', 0))
        for tool in ('search_sessions', 'get_chunks', 'get_session'):
            with self.subTest(tool=tool):
                wire = copy.deepcopy(event)
                if tool == 'get_chunks':
                    wire = {'taskId': 'opaque', 'tool': tool, 'arguments': {'sessionId': SID, 'revision': VIEW['revision'], 'generationId': VIEW['generationId']},
                            'result': {'view': VIEW, 'chunks': [chunk('Approved 4319', 0)], 'total': 1, 'offset': 0}}
                if tool == 'get_session':
                    wire = {'taskId': 'opaque', 'tool': tool, 'arguments': {'sessionId': SID, 'revision': VIEW['revision'], 'generationId': VIEW['generationId']}, 'result': event['result']['hits'][0]}
                observation = self.observe(wire).observations[0]
                self.assertEqual(observation.kind, 'verbatim-snippet')
                self.assertEqual(observation.text, 'Approved 4319')
                self.assertTrue(citation_occurrences(self.citation('Approved 4319'), self.observe(wire), self.sources))

    def test_annotations_are_not_source_and_multispan_is_explicitly_unsupported(self):
        source_chunk = chunk(); source_chunk['summary'] = 'GOLD summary only'
        self.assertFalse(citation_occurrences(self.citation('GOLD summary only'), self.observe(search(source_chunk)), self.sources))
        source_chunk['spans'].append(dict(source_chunk['spans'][0]))
        observed = self.observe(search(source_chunk))
        self.assertEqual(observed.observations, ())
        self.assertEqual(observed.diagnostics[0].code, 'unsupported-source-encoding')

    def test_falsified_single_span_fails_closed(self):
        source_chunk = chunk(); source_chunk['text'] = '9999'
        with self.assertRaisesRegex(EvidenceIntegrityError, 'source text/range mismatch'):
            self.observe(search(source_chunk))

    def test_failed_call_produces_no_observations(self):
        event = context(); event.pop('result'); event['error'] = {'code': 'read-budget'}
        self.assertEqual(self.observe(event).observations, ())

    def test_wrong_pin_and_context_metadata_are_rejected(self):
        mutations = [lambda e: e['result'].update(sessionId='foreign'),
            lambda e: e['result'].update(view={**VIEW, 'revision': 2}),
            lambda e: e['arguments']['view'].update(revision=2),
            lambda e: e['result']['anchor'].update(messagePosition=0),
            lambda e: e['result']['anchor'].update(start=0),
            lambda e: e['result']['excerpts'][0]['source'].update(start=0),
            lambda e: e['result']['excerpts'][0].update(role='user'),
            lambda e: e['result'].update(previous=None),
            lambda e: e['result'].update(next={'messageId': 'm', 'start': 0, 'end': 1}),
            lambda e: e['arguments'].update(beforeBytes=3)]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                event = copy.deepcopy(context()); mutate(event)
                with self.assertRaises(EvidenceIntegrityError): self.observe(event)

    def test_utf8_scalar_endpoints_emoji_and_combining(self):
        self.assertEqual(scalar_range(NORMALIZED, 0, 4), '😀')
        self.assertEqual(scalar_range(NORMALIZED, 4, 7), 'e\u0301')
        for start, end in [(1, 4), (0, 3), (5, 6), (-1, 0)]:
            with self.subTest(start=start, end=end), self.assertRaises(EvidenceIntegrityError): scalar_range(NORMALIZED, start, end)

    def test_repeated_quote_has_all_absolute_occurrences_but_no_unseen_occurrence(self):
        both = citation_occurrences(self.citation('4319'), self.observe(whole()), self.sources)
        self.assertEqual([(o.start, o.end) for o in both], [byte_range('4319', 0), byte_range('4319', 1)])
        one = citation_occurrences(self.citation('4319'), self.observe(context()), self.sources)
        self.assertEqual([(o.start, o.end) for o in one], [byte_range('4319', 1)])
        wrong = self.citation('4319'); wrong['view'] = {**VIEW, 'revision': 2}
        self.assertFalse(citation_occurrences(wrong, self.observe(whole()), self.sources))

    def test_disjoint_quote_assembly_is_never_allowed(self):
        first = search(chunk('Approved ', 0)); second = search(chunk('4319', 1))
        self.assertFalse(citation_occurrences(self.citation('Approved 4319'), self.observe(first, second), self.sources))
        self.assertTrue(citation_occurrences(self.citation('4319'), self.observe(first, second), self.sources))

    def test_adjacent_empty_messages_order_and_continuations(self):
        fixture = self.inputs.fixture.json()
        fixture['documents'][0]['paddingBefore'] = 0
        fixture['documents'][0]['messages'] = [{'id': 'a', 'text': '😀'}, {'id': 'b', 'text': ''}, {'id': 'c', 'text': 'e\u0301'}]
        sources = FrozenSources.from_fixture(fixture, self.inputs.catalog.json()['documents'], 'reader')
        args = {'sessionId': SID, 'view': VIEW, 'anchor': {'messageId': 'b', 'start': 0, 'end': 0}, 'beforeBytes': 4, 'afterBytes': 4}
        result = {'sessionId': SID, 'view': VIEW, 'anchor': {'messageId': 'b', 'messagePosition': 1, 'start': 0, 'end': 0},
                  'excerpts': [{'source': {'messageId': mid, 'messagePosition': position, 'start': 0, 'end': len(utf8(text))}, 'role': 'user', 'text': text}
                               for position, (mid, text) in enumerate([('a', '😀'), ('b', ''), ('c', 'e\u0301')])], 'previous': None, 'next': None}
        event = {'taskId': 'opaque', 'tool': 'read_message_context', 'arguments': args, 'result': result}
        observed = observe_trace('opaque', [event], sources)
        self.assertEqual([o.text for o in observed.observations], ['😀', '', 'e\u0301'])
        event['result']['excerpts'].reverse()
        with self.assertRaises(EvidenceIntegrityError): observe_trace('opaque', [event], sources)

    def test_unauthorized_source_is_integrity_failure(self):
        fixture = self.inputs.fixture.json(); fixture['documents'].append({'id': 'private', 'principal': 'other', 'messages': [{'id': 'secret', 'text': 'private'}]})
        catalog = self.inputs.catalog.json()['documents']; catalog['private'] = {'sessionId': 'private-session', 'view': VIEW}
        sources = FrozenSources.from_fixture(fixture, catalog, 'reader')
        event = search(); event['result']['hits'][0]['session']['id'] = 'private-session'
        with self.assertRaisesRegex(EvidenceIntegrityError, 'unauthorized'): observe_trace('opaque', [event], sources)

    def test_boolean_position_is_not_an_integer_wire_position(self):
        fixture = self.inputs.fixture.json(); fixture['documents'][0]['paddingBefore'] = 0
        sources = FrozenSources.from_fixture(fixture, self.inputs.catalog.json()['documents'], 'reader')
        event = context(); event['result']['anchor']['messagePosition'] = False
        event['result']['excerpts'][0]['source']['messagePosition'] = False
        with self.assertRaises(EvidenceIntegrityError): observe_trace('opaque', [event], sources)

    def test_nine_excerpt_cap_and_zero_width_boundary_continuations(self):
        fixture = self.inputs.fixture.json(); fixture['documents'][0]['paddingBefore'] = 0
        fixture['documents'][0]['messages'] = [{'id': f'm{n}', 'text': 'a'} for n in range(11)]
        sources = FrozenSources.from_fixture(fixture, self.inputs.catalog.json()['documents'], 'reader')
        def wire(anchor, before, after, pieces, previous, following):
            message_id, position, start, end = anchor
            return {'taskId': 'opaque', 'tool': 'read_message_context', 'arguments': {'sessionId': SID, 'view': VIEW,
                'anchor': {'messageId': message_id, 'start': start, 'end': end}, 'beforeBytes': before, 'afterBytes': after},
                'result': {'sessionId': SID, 'view': VIEW, 'anchor': {'messageId': message_id, 'messagePosition': position, 'start': start, 'end': end},
                    'excerpts': [{'source': {'messageId': f'm{p}', 'messagePosition': p, 'start': a, 'end': b}, 'role': 'user', 'text': 'a'[a:b]} for p, a, b in pieces],
                    'previous': previous, 'next': following}}
        previous = {'messageId': 'm1', 'start': 0, 'end': 0}; following = {'messageId': 'm9', 'start': 1, 'end': 1}
        initial = wire(('m5', 5, 0, 1), 2048, 2048, [(p, 0, 1) for p in range(1, 10)], previous, following)
        self.assertEqual(len(observe_trace('opaque', [initial], sources).observations), 9)
        left = wire(('m1', 1, 0, 0), 2048, 0, [(0, 0, 1), (1, 0, 0)], None, previous)
        right = wire(('m9', 9, 1, 1), 0, 2048, [(9, 1, 1), (10, 0, 1)], following, None)
        remaining = observe_trace('opaque', [left, right], sources).observations
        self.assertEqual([(o.message_position, o.text) for o in remaining], [(0, 'a'), (1, ''), (9, ''), (10, 'a')])

    def test_anchor_budget_never_clips_and_null_generation_is_explicit(self):
        fixture = self.inputs.fixture.json(); fixture['documents'][0]['paddingBefore'] = 0
        fixture['documents'][0]['messages'] = [{'id': 'm', 'text': '😀' * 513}]
        catalog = self.inputs.catalog.json()['documents']; catalog['decision']['view'] = {**VIEW, 'generationId': None}
        sources = FrozenSources.from_fixture(fixture, catalog, 'reader'); view = catalog['decision']['view']
        source = {'messageId': 'm', 'messagePosition': 0, 'start': 0, 'end': 2048}
        event = {'taskId': 'opaque', 'tool': 'read_message_context', 'arguments': {'sessionId': SID, 'view': view,
            'anchor': {'messageId': 'm', 'start': 0, 'end': 2048}, 'beforeBytes': 0, 'afterBytes': 0},
            'result': {'sessionId': SID, 'view': view, 'anchor': source, 'excerpts': [{'source': source, 'role': 'user', 'text': '😀' * 512}],
                'previous': None, 'next': {'messageId': 'm', 'start': 2048, 'end': 2048}}}
        self.assertEqual(len(utf8(observe_trace('opaque', [event], sources).observations[0].text)), 2048)
        event['arguments']['anchor']['end'] = 2052
        with self.assertRaisesRegex(EvidenceIntegrityError, 'anchor exceeds'): observe_trace('opaque', [event], sources)

    def test_boolean_source_endpoint_cannot_alias_integer(self):
        source_chunk = chunk(); source_chunk['spans'][0]['start'] = True
        with self.assertRaisesRegex(EvidenceIntegrityError, 'integer source endpoints'): self.observe(search(source_chunk))


    def legacy_events(self, pinned):
        pin = {'revision': VIEW['revision'], 'generationId': VIEW['generationId']} if pinned else {}
        message = whole(); message['arguments'] = {'sessionId': SID, 'offset': 2, 'limit': 1, **pin}
        chunks = {'taskId': 'opaque', 'tool': 'get_chunks', 'arguments': {'sessionId': SID, **pin},
                  'result': {'view': VIEW, 'offset': 0, 'total': 1, 'chunks': [chunk()]}}
        session = {'taskId': 'opaque', 'tool': 'get_session', 'arguments': {'sessionId': SID, **pin},
                   'result': {'session': {'id': SID, 'view': VIEW}, 'chunks': [chunk()]}}
        recorded = json.loads((Path(__file__).parent / 'data/recorded-agent-catalog.json').read_text())['catalog']
        schemas = {tool['name']: json.loads(tool['inputSchemaJson']) for tool in recorded['tools']}
        for event in (message, chunks, session):
            schema = schemas[event['tool']]
            self.assertTrue(set(event['arguments']).issubset(schema['properties']))
            self.assertTrue(set(schema['required']).issubset(event['arguments']))
            self.assertFalse(schema['additionalProperties'])
        return message, chunks, session

    def test_recorded_schema_flat_pins_for_all_three_legacy_reads(self):
        for event in self.legacy_events(True):
            with self.subTest(tool=event['tool']):
                original = copy.deepcopy(event)
                observed = self.observe(event)
                self.assertEqual(len(observed.observations), 1)
                self.assertEqual(observed.observations[0].view.wire(), VIEW)
                self.assertEqual(event, original)

    def test_unpinned_legacy_result_must_bind_exact_frozen_view_without_argument_invention(self):
        for event in self.legacy_events(False):
            with self.subTest(tool=event['tool']):
                original = copy.deepcopy(event)
                observed = self.observe(event)
                self.assertEqual(observed.observations[0].view.wire(), VIEW)
                self.assertNotIn('revision', event['arguments'])
                self.assertNotIn('view', event['arguments'])
                self.assertEqual(event, original)
                bad = copy.deepcopy(event)
                returned_view = bad['result']['session']['view'] if event['tool'] == 'get_session' else bad['result']['view']
                returned_view['revision'] = 2
                with self.assertRaises(EvidenceIntegrityError): self.observe(bad)

    def test_recorded_legacy_default_message_and_chunk_paging(self):
        message, chunks, _ = self.legacy_events(True)
        message['arguments'].pop('offset'); message['arguments'].pop('limit')
        message['result'].update(offset=0, messages=[{'id': m.message_id, 'text': m.text, 'role': m.role, 'recordIndex': 999}
                                                   for m in self.sources.messages])
        self.assertEqual([o.message_position for o in self.observe(message).observations], [0, 1, 2])
        self.assertEqual(len(self.observe(chunks).observations), 1)

    def test_legacy_nested_view_generation_only_and_wrong_explicit_pin_fail(self):
        for event in self.legacy_events(True):
            for patch in ({'view': VIEW}, {'revision': 2, 'generationId': VIEW['generationId']},
                          {'revision': 1, 'generationId': 'foreign-generation'}, {'revision': 1},
                          {'generationId': VIEW['generationId']}, {'revision': 1, 'generationId': None}):
                with self.subTest(tool=event['tool'], patch=patch):
                    bad = copy.deepcopy(event)
                    bad['arguments'].pop('revision'); bad['arguments'].pop('generationId')
                    bad['arguments'].update(patch)
                    with self.assertRaises(EvidenceIntegrityError): self.observe(bad)
            bad = copy.deepcopy(event); bad['arguments']['view'] = VIEW
            with self.assertRaises(EvidenceIntegrityError): self.observe(bad)

    def test_legacy_revision_only_is_explicit_null_generation_not_published_fallback(self):
        catalog = copy.deepcopy(self.inputs.catalog.json()['documents']); catalog['decision']['view']['generationId'] = None
        sources = FrozenSources.from_fixture(self.inputs.fixture.json(), catalog, 'reader')
        for event in self.legacy_events(True):
            with self.subTest(tool=event['tool']):
                event = copy.deepcopy(event); event['arguments'].pop('generationId')
                result_view = event['result']['session']['view'] if event['tool'] == 'get_session' else event['result']['view']
                result_view['generationId'] = None
                observed = observe_trace('opaque', [event], sources)
                self.assertIsNone(observed.observations[0].view.generation_id)

    def test_empty_utf8_range_checks_both_scalar_endpoints(self):
        self.assertEqual(scalar_range('😀', 0, 0), '')
        self.assertEqual(scalar_range('😀', 4, 4), '')
        for text, endpoint in [('😀', 1), ('😀', 2), ('😀', 3), ('e\u0301', 2)]:
            with self.subTest(text=text, endpoint=endpoint), self.assertRaisesRegex(EvidenceIntegrityError, 'scalar'):
                scalar_range(text, endpoint, endpoint)

    def test_actual_core_nul_projection_wire_is_literal_escape_not_removal(self):
        core = Path(__file__).resolve().parents[3] / 'server/src/main/scala/chronicle/Core.scala'
        self.assertIn(r'def text(value: String): String = value.replace("\u0000", "\\u0000")', core.read_text())
        actual_archived = '😀e\u0301\\u0000 Rejected 4319. Approved 4319. cache entries are not copied.'
        event = whole(); event['result']['messages'][0]['text'] = actual_archived
        observed = self.observe(event)
        self.assertEqual(observed.observations[0].text, actual_archived)
        self.assertEqual(observed.observations[0].end, len(actual_archived.encode('utf-8')))
        self.assertTrue(citation_occurrences(self.citation('\\u0000'), observed, self.sources))
        self.assertFalse(citation_occurrences(self.citation('\x00'), observed, self.sources))
