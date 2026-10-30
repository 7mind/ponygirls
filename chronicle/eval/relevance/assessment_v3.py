"""Additive v3 assessment of exact, preserved artifacts; no model calls or truth aliases."""
import argparse
from dataclasses import asdict, dataclass, fields
import hashlib
import json
from pathlib import Path
from source_observations_v3 import (EvidenceIntegrityError, FrozenSources, View, citation_occurrences,
                                    observe_trace, require, scalar_range, utf8)

POLICY = 'evidence-assessment-v3'
REVIEW_POLICY = 'blinded-factual-citation-review-v1'
ROLES = {'requested-fact', 'rejected-contrast', 'contradictory', 'irrelevant'}
RETRIEVAL_K = 5


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON field: ' + key)
        result[key] = value
    return result


def decode(raw):
    return json.loads(raw, object_pairs_hook=unique_fields)


@dataclass(frozen=True)
class BoundArtifact:
    raw: bytes
    expected_sha256: str

    def verify(self):
        require(sha256(self.raw) == self.expected_sha256, 'artifact hash mismatch')

    def json(self):
        self.verify()
        return decode(self.raw)

    def jsonl(self):
        self.verify()
        return [decode(line) for line in self.raw.splitlines() if line.strip()]


@dataclass(frozen=True)
class CellInputs:
    task_id: str
    opaque_id: str
    expected_prompt_sha256: str
    fixture: BoundArtifact
    catalog: BoundArtifact
    rubric: BoundArtifact
    configuration: BoundArtifact
    mapping: BoundArtifact
    schedule: BoundArtifact
    run: BoundArtifact
    native_outcome: BoundArtifact
    outcome: BoundArtifact
    controller: BoundArtifact
    trace: BoundArtifact
    fixed_retrieval: BoundArtifact
    answer: BoundArtifact | None
    review: BoundArtifact | None
    # Optional prior assessments are retained, never recomputed on v3 tool traces.
    legacy_metrics: BoundArtifact | None


@dataclass(frozen=True)
class RequiredRange:
    document: str
    message_id: str
    start: int
    end: int

    @classmethod
    def parse(cls, value, sources, catalog):
        require(set(value) == {'document', 'messageId', 'start', 'end'}, 'exact rubric range fields required')
        published = catalog[value['document']]
        message = sources.resolve(published['sessionId'], View.parse(published['view']), value['messageId'])
        scalar_range(message.text, value['start'], value['end'])
        require(value['end'] > value['start'], 'nonempty proposition range required')
        return cls(value['document'], value['messageId'], value['start'], value['end'])


@dataclass(frozen=True)
class Proposition:
    id: str
    value_index: int
    anchors_any: tuple[RequiredRange, ...]
    qualifiers_all: tuple[RequiredRange, ...]
    factual_criteria: str


def propositions_for(fixture, rubric, task, sources, catalog, fixture_sha):
    require(rubric['policy'] == POLICY and rubric['fixtureSha256'] == fixture_sha, 'rubric policy/fixture mismatch')
    require(set(rubric['tasks']) == {t['id'] for t in fixture['tasks']}, 'exact rubric task coverage required')
    entry = rubric['tasks'][task['id']]
    require(entry['principal'] == task['principal'], 'rubric principal mismatch')
    propositions = []
    for prop in entry['propositions']:
        require(type(prop['id']) is str and bool(prop['id']), 'nonempty proposition id required')
        require(type(prop['valueIndex']) is int, 'integer valueIndex required')
        require(type(prop['factualCriteria']) is str and bool(prop['factualCriteria'].strip()), 'explicit factual criteria required')
        anchors = tuple(RequiredRange.parse(r, sources, catalog) for r in prop['anchorsAny'])
        qualifiers = tuple(RequiredRange.parse(r, sources, catalog) for r in prop['qualifiersAll'])
        require(bool(anchors) and bool(qualifiers), 'explicit anchors and qualifier/status ranges required')
        require(all(r.document in task['relevant'] for r in anchors + qualifiers), 'rubric source outside required relevant documents')
        propositions.append(Proposition(prop['id'], prop['valueIndex'], anchors, qualifiers, prop['factualCriteria']))
    require(len({p.id for p in propositions}) == len(propositions), 'duplicate proposition identity')
    require(sorted(p.value_index for p in propositions) == list(range(len(task['facts']['values']))), 'one proposition per ordered slot required')
    require(bool(propositions) == bool(task['evidence']), 'rubric positive/abstention mismatch')
    return tuple(propositions)


def schema_valid(answer, opaque):
    if type(answer) is not dict or set(answer) != {'taskId', 'facts', 'abstain', 'citations'}:
        return False
    if answer['taskId'] != opaque or type(answer['abstain']) is not bool or type(answer['citations']) is not list:
        return False
    facts = answer['facts']
    if type(facts) is not dict or set(facts) != {'values'} or type(facts['values']) is not list or not all(type(v) is str for v in facts['values']):
        return False
    for citation in answer['citations']:
        if type(citation) is not dict or set(citation) != {'sessionId', 'view', 'messageId', 'quote'}:
            return False
        if not all(type(citation[key]) is str for key in ('sessionId', 'messageId', 'quote')):
            return False
        try:
            View.parse(citation['view']); utf8(citation['quote'])
        except EvidenceIntegrityError:
            return False
    return True


def literal_conformance(task, answer, fixture):
    require(fixture['factFormat'] == 'ordered-string-values-v1', 'explicit ordered-string-values-v1 required')
    require(fixture['factNormalization'] == 'casefold-and-collapse-whitespace-only', 'unsupported literal normalization')
    expected = task['facts']['values']; aliases = task['factAliases']
    require(len(aliases) == len(expected) and all(type(a) is list and all(type(v) is str for v in a) for a in aliases), 'explicit per-slot aliases required')
    normalize = lambda value: ' '.join(value.casefold().split())
    values = answer['facts']['values']
    return len(values) == len(expected) and all(normalize(actual) in {normalize(value) for value in [gold, *allowed]}
                                               for actual, gold, allowed in zip(values, expected, aliases))


def range_trace_indices(required, observations, catalog):
    published = catalog[required.document]; view = View.parse(published['view'])
    return sorted({o.trace_index for o in observations.observations
                   if (o.session_id, o.view, o.message_id) == (published['sessionId'], view, required.message_id)
                   and o.start <= required.start and required.end <= o.end})


def occurrence_contains(required, occurrence, catalog):
    published = catalog[required.document]
    return (occurrence.session_id == published['sessionId'] and occurrence.view == View.parse(published['view'])
            and occurrence.message_id == required.message_id and occurrence.start <= required.start and required.end <= occurrence.end)


def reviewed_judgment(manifest, inputs, citations, propositions):
    if manifest is None:
        return {'available': False, 'reason': 'no explicit blinded review manifest', 'factualCorrect': None, 'citationRoles': None}
    require(manifest['policy'] == REVIEW_POLICY and manifest['blinded'] is True, 'frozen blinded review method required')
    expected = {name: getattr(inputs, name).expected_sha256 for name in ('fixture', 'rubric', 'answer', 'trace', 'run', 'native_outcome')}
    require(manifest['inputHashes'] == expected and manifest['opaqueId'] == inputs.opaque_id, 'review artifact/opaque binding mismatch')
    records = manifest['reviews']; require(type(records) is list and bool(records), 'nonempty explicit review records required')
    ids = set()
    def verdict(record, adjudication):
        require(record['reviewId'] not in ids, 'duplicate review identity'); ids.add(record['reviewId'])
        require(record['reviewerKind'] in ({'root-adjudication'} if adjudication else {'agent-assisted', 'human'}), 'explicit reviewer provenance required')
        require(all(type(record[key]) is str and bool(record[key].strip()) for key in ('reviewId', 'reviewerId', 'method', 'rationale')), 'review provenance/rationale required')
        require(type(record['factualCorrect']) is bool, 'explicit reviewed factual boolean required')
        roles = record['citationRoles']
        require(all(type(role['citationIndex']) is int for role in roles), 'integer review citation indices required')
        require(sorted(role['citationIndex'] for role in roles) == list(range(len(citations))), 'review every citation exactly once')
        for role in roles:
            require(role['role'] in ROLES and type(role['rationale']) is str and bool(role['rationale'].strip()), 'explicit citation role/rationale required')
            require(set(role['propositionIds']).issubset({p.id for p in propositions}), 'unknown reviewed proposition identity')
        return record['factualCorrect'], sorted(roles, key=lambda r: r['citationIndex'])
    verdicts = [verdict(record, False) for record in records]
    # Rationale wording may differ; judgments must agree on facts, roles and assignments.
    signature = lambda v: (v[0], [(r['citationIndex'], r['role'], sorted(r['propositionIds'])) for r in v[1]])
    adjudication = manifest.get('adjudication')
    if adjudication is not None:
        selected = verdict(adjudication, True)
        require(set(adjudication['resolvesReviewIds']) == {r['reviewId'] for r in records}, 'adjudication must name all reviewed records')
    elif any(signature(v) != signature(verdicts[0]) for v in verdicts[1:]):
        return {'available': False, 'reason': 'review disagreement without explicit root adjudication', 'factualCorrect': None,
                'citationRoles': None, 'manifest': manifest}
    else:
        selected = verdicts[0]
    return {'available': True, 'factualCorrect': selected[0], 'citationRoles': selected[1], 'manifest': manifest,
            'reason': 'explicit recorded blinded review; no alias-derived semantic judgment'}


def retrieval_metrics(result, relevant, k):
    ids = list(dict.fromkeys(hit['session']['id'] for hit in result['hits']))[:k]
    return {'recallAtK': len(relevant.intersection(ids)) / len(relevant) if relevant else None,
            'mrr': next((1 / index for index, sid in enumerate(ids, 1) if sid in relevant), 0) if relevant else None}


def assess_cell(inputs: CellInputs):
    artifacts = {field.name: getattr(inputs, field.name) for field in fields(inputs) if isinstance(getattr(inputs, field.name), BoundArtifact)}
    for artifact in artifacts.values():
        artifact.verify()
    fixture = inputs.fixture.json(); catalog = inputs.catalog.json(); rubric = inputs.rubric.json()
    config = inputs.configuration.json(); mapping = inputs.mapping.json(); schedule = inputs.schedule.json()
    run = inputs.run.json(); native = inputs.native_outcome.json(); outcome = inputs.outcome.json()
    controller = inputs.controller.json(); trace = inputs.trace.jsonl()
    answer = inputs.answer.json() if inputs.answer is not None else None
    require(catalog['fixtureSha256'] == inputs.fixture.expected_sha256, 'catalog fixture hash mismatch')
    task = next((t for t in fixture['tasks'] if t['id'] == inputs.task_id), None)
    require(task is not None and mapping[inputs.opaque_id] == inputs.task_id, 'task/opaque mapping mismatch')
    require(set(mapping) == {t['id'] for t in config['tasks']} and len(mapping) == len(config['tasks']), 'exact opaque task set required')
    require(all(set(t) == {'id', 'question'} for t in config['tasks']), 'model task contains evaluator fields')
    require(next(t['question'] for t in config['tasks'] if t['id'] == inputs.opaque_id) == task['question'], 'model question mismatch')
    require(config['login'] == task['principal'] and config['mode'] in ('lexical', 'semantic', 'hybrid') and config['relatedPolicy'] == 'deny', 'principal/mode/policy mismatch')
    if 'scheduleCell' in run:
        scheduled = run['scheduleCell']
        require(type(scheduled) is dict and set(scheduled) == {'batchId', 'arm', 'repeat', 'mode', 'taskId', 'ordinal'}, 'exact scheduleCell fields required')
        require(all(type(scheduled[key]) is str and bool(scheduled[key]) for key in ('batchId', 'arm')), 'explicit batch/arm identity required')
        require(type(scheduled['repeat']) is int and scheduled['repeat'] > 0 and type(scheduled['ordinal']) is int and scheduled['ordinal'] >= 0, 'integer repeat/ordinal required')
        require(scheduled['mode'] == config['mode'] and scheduled['taskId'] == inputs.task_id, 'scheduleCell mode/task mismatch')
        canonical = lambda row: json.dumps(row, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
        require(sum(canonical(row) == canonical(scheduled) for row in schedule['trials']) == 1, 'exact scheduleCell not uniquely scheduled')
    else:
        matching = [row for row in schedule['trials'] if row['mode'] == config['mode'] and row['taskId'] == inputs.task_id]
        require(len(matching) == 1, 'cell not uniquely scheduled; repeated cells require run.scheduleCell')
        scheduled = matching[0]
    require(all(item['taskId'] == inputs.opaque_id for item in (run, native, outcome)), 'native/projected opaque identity mismatch')
    require(native['state'] == outcome['state'], 'native/projected outcome state mismatch')
    require(type(run['prompt']) is str and sha256(utf8(run['prompt'])) == inputs.expected_prompt_sha256, 'frozen prompt hash mismatch')
    require(type(outcome['traceComplete']) is bool, 'explicit trace completeness required')
    require(type(controller['exit']) is int, 'explicit controller exit required')
    if native['failure'] != outcome['failure']:
        require(outcome['failure'] is not None and outcome['failure']['type'] == 'trace-normalization-failed'
                and outcome['failure']['priorFailure'] == native['failure'], 'native failure was replaced')
    require(all(event['taskId'] == inputs.opaque_id for event in trace), 'trace opaque identity mismatch')
    violations = [index for index, event in enumerate(trace) if event['tool'] == 'related_sessions' or event['tool'] == 'search_sessions'
                  and (event['arguments']['mode'] != config['mode'] or event['arguments'].get('project') != config['project'])]
    require(type(outcome['conditionViolations']) is int and outcome['conditionViolations'] == len(violations), 'condition violation count mismatch')
    sources = FrozenSources.from_fixture(fixture, catalog['documents'], task['principal'])
    props = propositions_for(fixture, rubric, task, sources, catalog['documents'], inputs.fixture.expected_sha256)
    valid_schema = schema_valid(answer, inputs.opaque_id)
    ordered_slots = len(answer['facts']['values']) == len(task['facts']['values']) if valid_schema else None
    trace_complete = outcome['traceComplete'] and not (outcome['failure'] is not None and outcome['failure']['type'] == 'trace-normalization-failed')
    # Invalid recognized evidence is a cell-level integrity failure, never filtered away.
    integrity_failure = None
    try:
        observed = observe_trace(inputs.opaque_id, trace, sources)
    except (EvidenceIntegrityError, KeyError, TypeError, IndexError) as error:
        integrity_failure = str(error)
        observed = None
    evidence_available = trace_complete and observed is not None
    citations = answer['citations'] if valid_schema else []
    occurrences = [citation_occurrences(c, observed, sources) for c in citations] if evidence_available else None
    review = reviewed_judgment(inputs.review.json() if inputs.review is not None else None, inputs, citations, props) if valid_schema else {
        'available': False, 'reason': 'answer missing or schema-invalid', 'factualCorrect': None, 'citationRoles': None}
    role_conformance = all(role['role'] == 'rejected-contrast' or role['role'] == 'requested-fact' and bool(role['propositionIds'])
                           for role in review['citationRoles']) if review['available'] else None
    review = dict(review, citationRoleConformance=role_conformance)
    verdicts = []
    earliest = []
    for prop in props:
        anchors = [range_trace_indices(r, observed, catalog['documents']) for r in prop.anchors_any] if evidence_available else []
        qualifiers = [range_trace_indices(r, observed, catalog['documents']) for r in prop.qualifiers_all] if evidence_available else []
        available_at = max([min(min(indices) for indices in anchors if indices)] + [min(indices) for indices in qualifiers]) if (
            evidence_available and any(anchors) and all(qualifiers)) else None
        earliest.append(available_at)
        supporting = [index for index, found in enumerate(occurrences or []) if any(occurrence_contains(r, occurrence, catalog['documents'])
                      for r in prop.anchors_any for occurrence in found)]
        role_indices = [role['citationIndex'] for role in review['citationRoles'] if role['role'] == 'requested-fact' and prop.id in role['propositionIds']] if review['available'] else None
        supported = available_at is not None and bool(set(supporting).intersection(role_indices)) if role_indices is not None and evidence_available else None
        verdicts.append({'id': prop.id, 'valueIndex': prop.value_index, 'factualCriteria': prop.factual_criteria,
                         'anchorTraceIndices': anchors if evidence_available else None, 'qualifierTraceIndices': qualifiers if evidence_available else None,
                         'sourceValidAnchorCitationIndices': supporting if evidence_available else None,
                         'requestedFactCitationIndices': role_indices, 'firstObservableAvailabilityTraceIndex': available_at,
                         'supported': supported})
    first_available = max(earliest) if earliest and all(index is not None for index in earliest) else None
    searches = [(i, e) for i, e in enumerate(trace) if e['tool'] == 'search_sessions']
    successful = [(i, e) for i, e in searches if 'result' in e and 'error' not in e]
    relevant = {catalog['documents'][key]['sessionId'] for key in task['relevant']}
    fixed_artifact = inputs.fixed_retrieval.json()
    if 'request' in fixed_artifact:
        require(set(fixed_artifact) == {'request', 'result'}, 'exact versioned fixed retrieval wrapper required')
        fixed_request = fixed_artifact['request']; fixed = fixed_artifact['result']
        declared_query = task['fixedQueries'][config['mode']] if 'fixedQueries' in task else task['query']
        require(fixed_request['query'] == declared_query and fixed_request['mode'] == config['mode'] and fixed_request['project'] == config['project'], 'fixed query/mode/project mismatch')
        require(type(fixed_request['limit']) is int and fixed_request['limit'] == RETRIEVAL_K
                and type(fixed_request['offset']) is int and fixed_request['offset'] == 0, 'fixed retrieval requires limit5/offset0')
    else:
        require('fixedQueries' not in task, 'mode-specific fixed query requires bound request/result wrapper')
        fixed_request = None; fixed = fixed_artifact
    provenance_valid = all(bool(found) for found in occurrences) if occurrences is not None and valid_schema else None
    correct_abstention = answer['abstain'] is (not bool(task['evidence'])) if valid_schema else None
    native_eligible = native['state'] == 'Complete' and native['failure'] is None and inputs.answer is not None and trace_complete
    execution = native_eligible and controller['exit'] == 0
    roles_supported = all(v['supported'] is True for v in verdicts) if review['available'] and evidence_available else None
    returned_sessions = set()
    for event in trace:
        if 'result' not in event or 'error' in event:
            continue
        result = event['result']
        if not isinstance(result, dict):
            continue
        if event['tool'] in ('get_messages', 'get_chunks', 'read_message_context'):
            args = event['arguments']
            if isinstance(args, dict) and type(args.get('sessionId')) is str:
                returned_sessions.add(args['sessionId'])
        elif event['tool'] == 'get_session':
            session = result.get('session')
            if isinstance(session, dict) and type(session.get('id')) is str:
                returned_sessions.add(session['id'])
        elif event['tool'] in ('search_sessions', 'related_sessions'):
            hits = result.get('hits' if event['tool'] == 'search_sessions' else 'sessions')
            if not isinstance(hits, list):
                continue
            for hit in hits:
                if isinstance(hit, dict) and isinstance(hit.get('session'), dict) and type(hit['session'].get('id')) is str:
                    returned_sessions.add(hit['session']['id'])
    acl_leak = bool(returned_sessions.intersection(sources.unauthorized_sessions))
    context_gate = False
    if evidence_available and occurrences is not None and review['available']:
        # This is an additional usability observation, not a tool-name success proxy.
        for prop, verdict in zip(props, verdicts):
            for citation_index in verdict['requestedFactCitationIndices']:
                for occurrence in occurrences[citation_index]:
                    if not any(occurrence_contains(r, occurrence, catalog['documents']) for r in prop.anchors_any):
                        continue
                    for context_index in occurrence.trace_indices:
                        if trace[context_index]['tool'] != 'read_message_context':
                            continue
                        context_args = trace[context_index]['arguments']; anchor = context_args['anchor']
                        led = any(index < context_index and o.kind == 'verbatim-snippet' and o.trace_index == index
                                  and o.session_id == context_args['sessionId'] and o.view == View.parse(context_args['view'])
                                  and o.message_id == anchor['messageId'] and o.start <= anchor['start'] and anchor['end'] <= o.end
                                  for index, _ in successful for o in observed.observations)
                        qualified = all(any(o.trace_index == context_index and o.kind == 'context-excerpt'
                                            and context_index in range_trace_indices(r, observed, catalog['documents'])
                                            for o in observed.observations) for r in prop.qualifiers_all)
                        context_gate = context_gate or led and qualified and verdict['supported'] is True
    return {'assessmentPolicy': POLICY, 'taskId': inputs.task_id, 'opaqueId': inputs.opaque_id,
            'scheduleCell': scheduled,
            'scope': 'additive assessment; preserves original executions; retrospective old cohorts are not holdouts',
            'inputs': {name: artifact.expected_sha256 for name, artifact in artifacts.items()},
            'execution': {'nativeOutcome': native, 'projectedOutcome': outcome, 'controllerOutcome': controller,
                          'answerAvailable': inputs.answer is not None, 'traceComplete': trace_complete, 'nativeEligible': native_eligible, 'eligible': execution},
            'output': {'schemaValid': valid_schema, 'orderedSlotsConform': ordered_slots,
                       'literalAliasValueConformance': literal_conformance(task, answer, fixture) if valid_schema else None,
                       'correctAbstention': correct_abstention, 'literalMetricIsSemanticTruth': False},
            'review': review, 'evidence': {'available': evidence_available, 'integrityFailure': integrity_failure,
                'diagnostics': [asdict(d) for d in observed.diagnostics] if observed is not None else [],
                'observations': [o.wire() for o in observed.observations] if evidence_available else None,
                'citationProvenance': [[o.wire() for o in found] for found in occurrences] if occurrences is not None else None,
                'allCitationsValid': provenance_valid, 'propositions': verdicts, 'allPropositionsSupported': roles_supported},
            'evidenceAcquisition': {
                'available': evidence_available,
                'validatedSliceCount': len(observed.observations) if evidence_available else None,
                'validatedSliceBytesWithRepetitions': sum(len(utf8(o.text)) for o in observed.observations) if evidence_available else None,
                'observationsByKind': {kind: sum(o.kind == kind for o in observed.observations) for kind in
                    ('whole-message', 'context-excerpt', 'verbatim-snippet')} if evidence_available else None,
                'searchCalls': len(searches), 'contextReadCalls': sum(e['tool'] == 'read_message_context' for e in trace),
                'wholeMessageReadCalls': sum(e['tool'] == 'get_messages' for e in trace),
                'failedCalls': sum('error' in e for e in trace),
                'counterMeaning': 'observed trace operations/slice bytes, not database admitted bytes'},
            'navigation': {'firstRubricEvidenceAvailableTraceIndex': first_available,
                'availabilityMeaning': 'observable validated ranges, not model cognition',
                'postEvidenceOperations': len(trace) - first_available - 1 if first_available is not None else None,
                'searchContextCorrectCitationWithQualifier': context_gate if evidence_available and review['available'] else None,
                'fixedQueryPolicy': fixture.get('fixedQueryPolicy'), 'fixedQueryRequest': fixed_request,
                'fixedQueryRequestProvenance': 'bound request/result wrapper' if fixed_request is not None else 'unavailable in legacy result-only artifact',
                'fixedQueryAt5': retrieval_metrics(fixed, relevant, RETRIEVAL_K),
                'firstAttemptedSearchSucceeded': 'result' in searches[0][1] if searches and trace_complete else None,
                'firstAttemptedAt5': retrieval_metrics(searches[0][1]['result'], relevant, RETRIEVAL_K) if searches and 'result' in searches[0][1] and evidence_available else None,
                'firstSuccessfulAt5': retrieval_metrics(successful[0][1]['result'], relevant, RETRIEVAL_K) if successful and evidence_available else None,
                'toolCalls': len(trace), 'responseBytes': sum(len(utf8(json.dumps(e['result'], ensure_ascii=False, separators=(',', ':')))) for e in trace if 'result' in e),
                'byteMetricMeaning': 'normalized JSON response sizes, not database admitted bytes'},
            'conditions': {'mode': config['mode'], 'project': config['project'], 'principal': task['principal'], 'relatedPolicy': config['relatedPolicy'],
                           'violationTraceIndices': violations, 'aclLeak': acl_leak, 'aclObservationComplete': trace_complete and integrity_failure is None, 'aclScope': 'finite owner-separated fixture only; not general ACL proof'},
            'groundedAnswerSuccessV3': bool(execution and valid_schema and ordered_slots and correct_abstention and evidence_available and provenance_valid
                                          and review['available'] and review['factualCorrect'] and role_conformance and roles_supported and not violations and not acl_leak),
            'legacyAssessmentScope': 'separately supplied bound assessment; applicability must be established by caller; never recomputed on v3 traces',
            'legacyMetrics': inputs.legacy_metrics.json() if inputs.legacy_metrics is not None else {
                'strict': None, 'v2': None, 'reason': 'not recomputed; old tools-only scorer is unsupported for v3 traces'}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args(); manifest = decode(args.manifest.read_bytes())
    artifacts = {}
    artifact_names = {f.name for f in fields(CellInputs)} - {'task_id', 'opaque_id', 'expected_prompt_sha256'}
    require(set(manifest['artifacts']) == artifact_names, 'exact versioned per-cell artifact roles required')
    for name, entry in manifest['artifacts'].items():
        artifacts[name] = None if entry is None else BoundArtifact(Path(entry['path']).read_bytes(), entry['sha256'])
    required_artifacts = artifact_names - {'answer', 'review', 'legacy_metrics'}
    require(all(artifacts[name] is not None for name in required_artifacts), 'required artifact cannot be null')
    result = assess_cell(CellInputs(manifest['taskId'], manifest['opaqueId'], manifest['expectedPromptSha256'], **artifacts))
    with args.out.open('x') as output:
        json.dump(result, output, ensure_ascii=False, indent=2); output.write('\n')


if __name__ == '__main__':
    main()
