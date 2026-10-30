"""Private synthetic specified fixtures, not baseline answers or a quality cohort."""
from dataclasses import replace
import json
from assessment_v3 import BoundArtifact, CellInputs, sha256
from source_observations_v3 import utf8

VIEW = {'revision': 1, 'generationId': '00000000-0000-0000-0000-000000000001'}
SID = '00000000-0000-0000-0000-000000000002'
TEXT = '😀e\u0301\x00 Rejected 4319. Approved 4319. cache entries are not copied.'
NORMALIZED = TEXT.replace('\x00', r'\u0000')
PROMPT = 'Frozen synthetic opaque task prompt. Which approved port?'


def artifact(value, jsonl=False):
    raw = ('\n'.join(json.dumps(event, ensure_ascii=False) for event in value) + '\n').encode() if jsonl else json.dumps(value, ensure_ascii=False).encode()
    return BoundArtifact(raw, sha256(raw))


def byte_range(text, occurrence=0):
    raw = utf8(NORMALIZED); needle = utf8(text); start = -1
    for _ in range(occurrence + 1):
        start = raw.index(needle, start + 1)
    return start, start + len(needle)


def required(text, occurrence=0):
    start, end = byte_range(text, occurrence)
    return {'document': 'decision', 'messageId': 'm', 'start': start, 'end': end}


def chunk(text='4319', occurrence=1):
    start, end = byte_range(text, occurrence)
    return {'id': 'chunk', 'sessionId': SID, 'text': text, 'summary': 'This annotation is not source.', 'tags': ['decision'],
            'spans': [{'messageId': 'm', 'start': start, 'end': end}], 'score': 1}


def search(source_chunk=None):
    return {'taskId': 'opaque', 'tool': 'search_sessions', 'arguments': {'query': 'approved port', 'mode': 'lexical', 'project': 'p', 'limit': 5, 'offset': 0},
            'result': {'hits': [{'session': {'id': SID, 'view': VIEW}, 'chunks': [chunk() if source_chunk is None else source_chunk], 'score': 1}], 'total': 1}}


def context(text='4319', occurrence=1, before=9, after=0):
    start, end = byte_range(text, occurrence); low = start - before; high = end + after
    return {'taskId': 'opaque', 'tool': 'read_message_context', 'arguments': {'sessionId': SID, 'view': VIEW,
            'anchor': {'messageId': 'm', 'start': start, 'end': end}, 'beforeBytes': before, 'afterBytes': after},
            'result': {'sessionId': SID, 'view': VIEW, 'anchor': {'messageId': 'm', 'messagePosition': 2, 'start': start, 'end': end},
            'excerpts': [{'source': {'messageId': 'm', 'messagePosition': 2, 'start': low, 'end': high}, 'role': 'assistant', 'text': utf8(NORMALIZED)[low:high].decode()}],
            'previous': {'messageId': 'm', 'start': low, 'end': low}, 'next': {'messageId': 'm', 'start': high, 'end': high}}}


def whole():
    return {'taskId': 'opaque', 'tool': 'get_messages', 'arguments': {'sessionId': SID, 'revision': VIEW['revision'], 'generationId': VIEW['generationId'], 'offset': 2, 'limit': 1},
            'result': {'view': VIEW, 'offset': 2, 'total': 3, 'messages': [{'id': 'm', 'role': 'assistant', 'text': NORMALIZED, 'recordIndex': 999, 'parentId': None, 'timestamp': None}]}}


def cell(trace=None):
    fixture = artifact({'fixtureId': 'synthetic-v3', 'factFormat': 'ordered-string-values-v1', 'factNormalization': 'casefold-and-collapse-whitespace-only',
        'documents': [{'id': 'decision', 'principal': 'reader', 'paddingBefore': 2, 'messages': [{'id': 'm', 'role': 'assistant', 'text': TEXT}]}],
        'tasks': [{'id': 'q1', 'principal': 'reader', 'question': 'Which approved port?', 'split': 'synthetic', 'facts': {'values': ['4319']}, 'factAliases': [[]],
                   'relevant': ['decision'], 'evidence': [{'document': 'decision', 'messageId': 'm', 'quote': 'Approved 4319'}]}]})
    catalog = artifact({'fixtureSha256': fixture.expected_sha256, 'documents': {'decision': {'sessionId': SID, 'view': VIEW}}})
    rubric = artifact({'policy': 'evidence-assessment-v3', 'fixtureSha256': fixture.expected_sha256, 'tasks': {'q1': {'principal': 'reader',
        'propositions': [{'id': 'approved-port', 'valueIndex': 0, 'anchorsAny': [required('4319', 1)], 'qualifiersAll': [required('Approved')],
                          'factualCriteria': '4319 is the approved TCP port, not merely a rejected proposal.'}]}}})
    outcome = artifact({'taskId': 'opaque', 'state': 'Complete', 'failure': None, 'traceComplete': True, 'conditionViolations': 0})
    return CellInputs('q1', 'opaque', sha256(utf8(PROMPT)), fixture, catalog, rubric,
        artifact({'tasks': [{'id': 'opaque', 'question': 'Which approved port?'}], 'mode': 'lexical', 'project': 'p', 'relatedPolicy': 'deny', 'login': 'reader'}),
        artifact({'opaque': 'q1'}), artifact({'trials': [{'mode': 'lexical', 'taskId': 'q1'}]}),
        artifact({'taskId': 'opaque', 'prompt': PROMPT, 'runId': 'run', 'instanceId': 'instance'}), outcome, outcome,
        artifact({'exit': 0}), artifact([search(), context()] if trace is None else trace, jsonl=True), artifact(search()['result']),
        artifact({'taskId': 'opaque', 'facts': {'values': ['4319']}, 'abstain': False,
                  'citations': [{'sessionId': SID, 'view': VIEW, 'messageId': 'm', 'quote': '4319'}]}), None, None)


def with_review(inputs, correct=True, role='requested-fact'):
    review = {'policy': 'blinded-factual-citation-review-v1', 'blinded': True, 'opaqueId': inputs.opaque_id,
        'inputHashes': {name: getattr(inputs, name).expected_sha256 for name in ('fixture', 'rubric', 'answer', 'trace', 'run', 'native_outcome')},
        'reviews': [{'reviewId': 'r1', 'reviewerKind': 'agent-assisted', 'reviewerId': 'synthetic-reviewer', 'method': 'synthetic specified test judgment',
            'rationale': 'Compare current approved status and TCP-port units, not aliases.', 'factualCorrect': correct,
            'citationRoles': [{'citationIndex': 0, 'role': role, 'propositionIds': ['approved-port'], 'rationale': 'Citation occurrence belongs to approved port.'}]}]}
    return replace(inputs, review=artifact(review))
