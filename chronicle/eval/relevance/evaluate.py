"""Evaluator only. Never expose this module, fixtures or catalogs to an agent."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load(path):
    return json.loads(Path(path).read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, value):
    with Path(path).open('x') as output:
        json.dump(value, output, indent=2, ensure_ascii=False)
        output.write('\n')


def messages(document):
    padding = [{'id': f'padding-{n}', 'text': f'Routine heartbeat {n}; no decision recorded.'}
               for n in range(document.get('paddingBefore', 0))]
    return padding + document['messages']


def score(fixture, catalog, task, answer, trace, k):
    """Legacy six-case boundary: named facts and reader-owned authorization."""
    return score_task(fixture, catalog, task, answer, trace, k,
                      principal='reader', fact_format='named-facts-v1')


def facts_match(task, answer, fact_format, *, normalization):
    if fact_format == 'named-facts-v1':
        return answer['facts'] == task['facts']
    if fact_format != 'ordered-string-values-v1':
        raise ValueError('unknown fact format: ' + fact_format)
    if normalization != 'casefold-and-collapse-whitespace-only':
        raise ValueError('explicit supported fact normalization required')
    normalize = lambda value: ' '.join(value.casefold().split())
    expected = task['facts']
    if set(expected) != {'values'} or not isinstance(expected['values'], list) or not all(type(v) is str for v in expected['values']):
        raise ValueError('ordered ground truth requires string values')
    aliases = task['factAliases']
    if not isinstance(aliases, list) or len(aliases) != len(expected['values']) or not all(
            isinstance(group, list) and all(type(v) is str for v in group) for group in aliases):
        raise ValueError('explicit per-position alias lists required')
    actual = answer['facts']
    return (isinstance(actual, dict) and set(actual) == {'values'} and isinstance(actual['values'], list)
            and len(actual['values']) == len(expected['values'])
            and all(type(value) is str and normalize(value) in [normalize(item) for item in [required, *allowed]]
                    for value, required, allowed in zip(actual['values'], expected['values'], aliases)))


def score_task(fixture, catalog, task, answer, trace, k, *, principal, fact_format):
    if principal not in {d['principal'] for d in fixture['documents']}:
        raise ValueError('unknown evaluation principal')
    correct_facts = facts_match(task, answer, fact_format,
        normalization='exact' if fact_format == 'named-facts-v1' else fixture['factNormalization'])
    events = [e for e in trace if e['taskId'] == task['id'] and 'result' in e]
    reverse = {v['sessionId']: key for key, v in catalog.items()}
    searches = [e for e in events if e['tool'] == 'search_sessions']
    ranking = list(dict.fromkeys(hit['session']['id'] for hit in searches[0]['result']['hits']))[:k] if searches else []
    relevant = {catalog[key]['sessionId'] for key in task['relevant']}
    recall = len(relevant.intersection(ranking)) / len(relevant) if relevant else None
    mrr = next((1 / rank for rank, sid in enumerate(ranking, 1) if sid in relevant), 0) if relevant else None
    observed = {hit['session']['id'] for event in searches for hit in event['result']['hits']}
    observed.update(e['arguments']['sessionId'] for e in events if e['tool'] in ('get_session', 'get_messages', 'get_chunks'))
    forbidden_keys = set(task.get('forbidden', [])) | {d['id'] for d in fixture['documents'] if d['principal'] != principal}
    forbidden = {catalog[key]['sessionId'] for key in forbidden_keys}
    leak = bool(observed.intersection(forbidden))
    valid = []
    for citation in answer['citations']:
        sid = citation['sessionId']; key = reverse.get(sid); quote = citation['quote']
        if key is None or key not in task['relevant'] or citation['view'] != catalog[key]['view'] or not quote:
            valid.append(False); continue
        document = next(d for d in fixture['documents'] if d['id'] == key)
        source = next((m['text'] for m in messages(document) if m['id'] == citation['messageId']), '')
        seen = any(e['tool'] == 'get_messages' and e['arguments']['sessionId'] == sid
                   and e['result']['view'] == citation['view']
                   and any(m['id'] == citation['messageId'] and quote in m['text'] for m in e['result']['messages'])
                   for e in events)
        valid.append(seen and quote in source)
    supported = all(any(ok and c['sessionId'] == catalog[required['document']]['sessionId']
                        and c['messageId'] == required['messageId'] and required['quote'] in c['quote']
                        for c, ok in zip(answer['citations'], valid)) for required in task['evidence'])
    correct = answer['taskId'] == task['id'] and correct_facts
    abstention = answer['abstain'] is (not bool(task['evidence']))
    success = correct and abstention and supported and all(valid) and not leak
    return {'taskId': task['id'], 'split': task['split'], 'k': k, 'recallAtK': recall, 'mrr': mrr,
            'citationValidity': sum(valid) / len(valid) if valid else None, 'evidenceCoverage': supported,
            'factMatch': correct, 'answerSuccess': success, 'aclLeak': leak, 'retrievalExercised': bool(searches)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', type=Path, required=True)
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--answer', type=Path, required=True)
    parser.add_argument('--trace', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--k', type=int, required=True)
    parser.add_argument('--principal', required=True)
    parser.add_argument('--fact-format', required=True, choices=('named-facts-v1', 'ordered-string-values-v1'))
    args = parser.parse_args()
    if args.k <= 0:
        parser.error('k must be positive')
    fixture = load(args.fixture); catalog = load(args.catalog); answer = load(args.answer)
    if catalog['fixtureSha256'] != digest(args.fixture):
        raise ValueError('catalog/fixture hash mismatch')
    task = next(t for t in fixture['tasks'] if t['id'] == answer['taskId'])
    if 'principal' in task and task['principal'] != args.principal:
        raise ValueError('task/explicit principal mismatch')
    trace = [json.loads(line) for line in args.trace.read_text().splitlines()]
    result = score_task(fixture, catalog['documents'], task, answer, trace, args.k,
                        principal=args.principal, fact_format=args.fact_format)
    result.update(indexCoverage=catalog['indexCoverage'], blindness='UNESTABLISHED',
                  retrievalDefinition='first successful search response only; no multi-query rank pooling',
                  inputs={name: digest(getattr(args, name)) for name in ('fixture', 'catalog', 'answer', 'trace')})
    save(args.out, result)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
