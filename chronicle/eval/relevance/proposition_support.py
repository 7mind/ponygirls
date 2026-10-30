"""Additive evaluator-only proposition policy; never expose the rubric to models."""
import argparse
from pathlib import Path
import json
import hashlib
from evaluate import digest, load, messages, save, score_task

POLICY = 'proposition-support-v2'


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate rubric JSON field: ' + key)
        result[key] = value
    return result


def load_rubric(path):
    return json.loads(Path(path).read_text(), object_pairs_hook=unique_fields)


def validate_rubric(fixture, rubric, fixture_sha256):
    if rubric['policy'] != POLICY or rubric['fixtureSha256'] != fixture_sha256:
        raise ValueError('explicit proposition policy/fixture hash mismatch')
    for key in ('fixtureId', 'factFormat', 'factNormalization'):
        if rubric[key] != fixture[key]:
            raise ValueError('rubric/fixture metadata mismatch: ' + key)
    if fixture['factFormat'] != 'ordered-string-values-v1':
        raise ValueError('proposition v2 requires explicit ordered fact format')
    if len(fixture['tasks']) != len({task['id'] for task in fixture['tasks']}):
        raise ValueError('duplicate fixture task identity')
    if set(rubric['tasks']) != {task['id'] for task in fixture['tasks']}:
        raise ValueError('rubric must cover every fixture task exactly')
    documents = {doc['id']: doc for doc in fixture['documents']}
    identities = set()
    for task in fixture['tasks']:
        entry = rubric['tasks'][task['id']]; propositions = entry['propositions']
        if entry['principal'] != task['principal']:
            raise ValueError('rubric/task principal mismatch')
        indices = [prop['valueIndex'] for prop in propositions]
        if any(type(index) is not int for index in indices) or sorted(indices) != list(range(len(task['facts']['values']))):
            raise ValueError('exactly one proposition per ordered value required')
        if bool(propositions) != bool(task['evidence']):
            raise ValueError('propositions must preserve positive/abstention intent')
        for prop in propositions:
            if not prop['id'] or prop['id'] in identities:
                raise ValueError('unique nonempty proposition identity required')
            identities.add(prop['id'])
            if prop['document'] not in task['relevant']:
                raise ValueError('proposition must use a required relevant source')
            document = documents[prop['document']]
            if document['principal'] != task['principal']:
                raise ValueError('owner-only proposition source is unauthorized')
            source = next((m['text'] for m in messages(document) if m['id'] == prop['messageId']), None)
            if source is None:
                raise ValueError('unknown proposition message identity')
            anchors = prop['citationAnchorsAny']; contexts = prop['observedContextAll']
            if any(not isinstance(items, list) or not items or any(type(text) is not str or not text or text not in source for text in items)
                   for items in (anchors, contexts)):
                raise ValueError('nonempty exact source anchors and context required')
            evidence = [item for item in task['evidence'] if item['document'] == prop['document'] and item['messageId'] == prop['messageId']]
            if not evidence or not all(any(item['quote'] in context for context in contexts) for item in evidence):
                raise ValueError('observed context must retain the original source evidence')
            if not all(any(anchor in context for context in contexts) for anchor in anchors):
                raise ValueError('citation anchor must belong to required source context')


def assess(fixture, catalog, task, answer, trace, outcome, rubric, k, *, principal, fixture_sha256, answer_available):
    validate_rubric(fixture, rubric, fixture_sha256)
    if k <= 0:
        raise ValueError('k must be positive')
    if task not in fixture['tasks']:
        raise ValueError('task is not the exact fixture task')
    if outcome['taskId'] != task['id'] or any(event['taskId'] != task['id'] for event in trace):
        raise ValueError('outcome/trace projected task identity mismatch')
    if principal != task['principal']:
        raise ValueError('task/explicit principal mismatch')
    if type(answer_available) is not bool or type(outcome['traceComplete']) is not bool:
        raise ValueError('explicit boolean answer availability and trace completeness required')
    if type(outcome['conditionViolations']) is not int or outcome['conditionViolations'] < 0:
        raise ValueError('explicit nonnegative condition violation count required')
    legacy = score_task(fixture, catalog, task, answer, trace, k,
                        principal=principal, fact_format=fixture['factFormat'])
    valid = []
    for citation in answer['citations']:
        singleton = dict(answer, citations=[citation])
        validity = score_task(fixture, catalog, task, singleton, trace, k,
                              principal=principal, fact_format=fixture['factFormat'])
        valid.append(validity['citationValidity'] == 1)
    verdicts = []
    for prop in rubric['tasks'][task['id']]['propositions']:
        published = catalog[prop['document']]
        supporting = [index for index, (citation, ok) in enumerate(zip(answer['citations'], valid))
                      if ok and citation['sessionId'] == published['sessionId']
                      and citation['messageId'] == prop['messageId']
                      and any(anchor in citation['quote'] for anchor in prop['citationAnchorsAny'])]
        context_events = [index for index, event in enumerate(trace)
                          if event['taskId'] == task['id'] and event['tool'] == 'get_messages' and 'result' in event
                          and event['arguments']['sessionId'] == published['sessionId']
                          and event['result']['view'] == published['view']
                          and any(message['id'] == prop['messageId'] and all(context in message['text'] for context in prop['observedContextAll'])
                                  for message in event['result']['messages'])]
        supported = bool(supporting) and bool(context_events)
        rationale = ('valid exact-source citation anchor and required original context observed' if supported else
                     'no valid exact-source citation contains a required meaningful anchor' if not supporting else
                     'required original source context was not observed')
        verdicts.append({'id': prop['id'], 'valueIndex': prop['valueIndex'], 'document': prop['document'],
                         'messageId': prop['messageId'], 'supportingCitationIndices': supporting,
                         'citationAnchorsAny': prop['citationAnchorsAny'], 'requiredObservedContext': prop['observedContextAll'],
                         'contextObservedInTraceIndices': context_events, 'supported': supported, 'rationale': rationale})
    supported = all(item['supported'] for item in verdicts)
    abstention = answer['abstain'] is (not bool(task['evidence']))
    execution = (outcome['state'] == 'Complete' and outcome['failure'] is None and answer_available
                 and outcome['traceComplete'] and outcome['conditionViolations'] == 0)
    result = dict(legacy, assessmentPolicy=POLICY, fixtureSha256=fixture_sha256, propositionSupport=verdicts,
                  allPropositionsSupported=supported, allCitationsValid=all(valid), correctAbstention=abstention,
                  answerAvailable=answer_available, executionEligible=execution,
                  groundedAnswerSuccessV2=legacy['factMatch'] and abstention and supported and all(valid)
                      and not legacy['aclLeak'] and execution)
    if not outcome['traceComplete'] or outcome['failure'] is not None and outcome['failure'].get('type') == 'trace-normalization-failed':
        result.update(propositionEvidenceAvailable=False, assessmentUnavailableReason='incomplete or normalization-failed trace')
    else:
        result['propositionEvidenceAvailable'] = True
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('fixture', 'catalog', 'answer', 'trace', 'outcome', 'rubric', 'out'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--principal', required=True)
    parser.add_argument('--answer-available', choices=('yes', 'no'), required=True)
    parser.add_argument('--k', type=int, required=True)
    args = parser.parse_args()
    if args.k <= 0:
        parser.error('k must be positive')
    fixture_bytes = args.fixture.read_bytes(); fixture = json.loads(fixture_bytes)
    catalog = load(args.catalog); answer = load(args.answer)
    fixture_sha = hashlib.sha256(fixture_bytes).hexdigest()
    if catalog['fixtureSha256'] != fixture_sha:
        raise ValueError('catalog/fixture hash mismatch')
    task = next(task for task in fixture['tasks'] if task['id'] == answer['taskId'])
    outcome = load(args.outcome)
    if outcome['taskId'] != answer['taskId']:
        raise ValueError('outcome/projected answer identity mismatch')
    trace = [json.loads(line) for line in args.trace.read_text().splitlines()]
    if any(event['taskId'] != answer['taskId'] for event in trace):
        raise ValueError('trace/projected answer identity mismatch')
    result = assess(fixture, catalog['documents'], task, answer, trace, outcome, load_rubric(args.rubric), args.k,
                    principal=args.principal, fixture_sha256=fixture_sha, answer_available=args.answer_available == 'yes')
    result.update(inputs={name: digest(getattr(args, name)) for name in ('fixture', 'catalog', 'answer', 'trace', 'outcome', 'rubric')},
                  assessmentScope='criterion amendment; retain original strict scores and original execution outcomes')
    save(args.out, result)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
