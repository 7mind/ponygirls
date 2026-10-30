"""Model-free, run-layout-specific additive assessment. Never mutates captured runs."""
import argparse
import hashlib
import json
from pathlib import Path
import os
import re
import evaluate
import proposition_support


def require(condition, message):
    if not condition:
        raise ValueError(message)


def lineage_artifact(path, original):
    parts = path.relative_to(original).parts
    if len(parts) == 2 and parts[0].startswith('agent-'):
        return parts[1] in ('input.json', 'catalog.json', 'evaluator-private-map.json', 'client-exit.json')
    if len(parts) == 3 and parts[0].startswith('agent-'):
        return parts[2] in ('run.json', 'outcome.json', 'events.json', 'answer.json') or re.fullmatch(r'page-\d+\.json', parts[2]) is not None
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('original', 'observed', 'rubric', 'out'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args(); os.umask(0o077)
    original = args.original.resolve(strict=True); observed = args.observed.resolve(strict=True); output = args.out.resolve()
    require(all(output != root and not output.is_relative_to(root) and not root.is_relative_to(output)
                for root in (original, observed)), 'output must be disjoint from original and observed inputs')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    inputs = {}
    def recorded_bytes(path):
        path = path.resolve(strict=True); raw = path.read_bytes(); sha = hashlib.sha256(raw).hexdigest()
        require(str(path) not in inputs or inputs[str(path)] == sha, 'input changed during assessment: ' + str(path))
        inputs[str(path)] = sha
        return raw
    def recorded(path):
        return json.loads(recorded_bytes(path))
    def sha(path):
        recorded_bytes(path)
        return inputs[str(path.resolve())]
    for module in (Path(__file__), Path(evaluate.__file__), Path(proposition_support.__file__)):
        recorded_bytes(module)
    bindings = recorded(original / 'bindings.json'); fixture_path = Path(bindings['fixture']['path'])
    fixture = recorded(fixture_path); fixture_sha = sha(fixture_path)
    require(fixture_sha == bindings['fixture']['sha256'], 'fixture binding hash mismatch')
    catalog = recorded(original / 'preflight/catalog.json')
    require(catalog['fixtureSha256'] == fixture_sha, 'catalog/fixture hash mismatch')
    rubric = json.loads(recorded_bytes(args.rubric), object_pairs_hook=proposition_support.unique_fields)
    proposition_support.validate_rubric(fixture, rubric, fixture_sha)
    schedule = recorded(original / 'schedule.json')['trials']; cells = set(); results = []
    lineage = {}
    if observed != original:
        manifest = recorded(observed / 'source-manifest.json'); lineage = manifest['originalFiles']
        for name, expected in lineage.items():
            path = Path(name).resolve(strict=True)
            require(path.is_relative_to(original), 'observed lineage names another original batch')
            require(lineage_artifact(path, original), 'unallowlisted original-source lineage artifact')
            require(sha(path) == expected, 'observed original-source lineage hash mismatch')
        require(len(manifest['parserSources']) == 2 and {Path(name).name for name in manifest['parserSources']} == {'reparse.mjs', 'live_protocol.mjs'}, 'sidecar parser source set mismatch')
        for name, expected in manifest['parserSources'].items():
            require(Path(name).name in ('reparse.mjs', 'live_protocol.mjs'), 'unknown sidecar parser source')
            archived = observed / 'parser-source' / Path(name).name
            require(not archived.is_symlink() and archived.resolve().is_relative_to(observed), 'parser archive escapes observed inputs')
            require(sha(archived) == expected, 'archived parser hash mismatch')
    tasks = {task['id']: task for task in fixture['tasks']}
    for group in sorted(path for path in original.glob('agent-*') if path.is_dir()):
        configuration = recorded(group / 'input.json'); mapping = recorded(group / 'evaluator-private-map.json')
        controller = recorded(group / 'client-exit.json'); model_tasks = configuration['tasks']
        require(all(set(task) == {'id', 'question'} for task in model_tasks), 'model task contains evaluator-only fields')
        require(len(model_tasks) == len(mapping) and {task['id'] for task in model_tasks} == set(mapping), 'opaque task mapping mismatch')
        require(configuration['mode'] in ('lexical', 'semantic', 'hybrid') and configuration['relatedPolicy'] == 'deny', 'comparison mode/policy mismatch')
        for opaque, task_id in mapping.items():
            require(Path(opaque).name == opaque and opaque not in ('.', '..'), 'invalid opaque directory identity')
            require(task_id in tasks, 'unknown evaluator task identity'); task = tasks[task_id]
            require(configuration['login'] == task['principal'], 'task principal mismatch')
            require(next(item['question'] for item in model_tasks if item['id'] == opaque) == task['question'], 'model question mismatch')
            cell = (configuration['mode'], task_id); require(cell not in cells, 'duplicate assessment cell'); cells.add(cell)
            native = group / opaque; directory = observed / group.name / opaque
            run = recorded(native / 'run.json'); original_outcome = recorded(native / 'outcome.json')
            outcome = recorded(directory / 'outcome.json'); pages = sorted(native.glob('page-*.json'))
            require(bool(pages), 'original terminal protocol page missing'); terminal = recorded(pages[-1])
            require(run['taskId'] == opaque and original_outcome['taskId'] == opaque and outcome['taskId'] == opaque, 'opaque outcome identity mismatch')
            require(all(terminal[key] == run[key] for key in ('instanceId', 'runId')), 'original persisted run identity mismatch')
            require(terminal['state'] == original_outcome['state'] == outcome['state'], 'original/observed native state mismatch')
            if observed != original:
                required = [group / name for name in ('input.json', 'evaluator-private-map.json', 'client-exit.json')]
                required += [native / name for name in ('run.json', 'outcome.json', 'events.json')] + pages
                require(all(str(path.resolve()) in lineage for path in required), 'sidecar original-source lineage incomplete')
                require(outcome['originalControllerOutcomeSha256'] == sha(native / 'outcome.json'), 'sidecar source outcome hash mismatch')
                failure = original_outcome['failure']
                failure = failure['priorFailure'] if failure is not None and failure.get('type') == 'trace-normalization-failed' else failure
                require(outcome['failure'] == failure, 'original/observed failure lineage mismatch')
            trace = [json.loads(line) for line in recorded_bytes(directory / 'trace.jsonl').decode().splitlines()]
            require(all(event['taskId'] == opaque for event in trace), 'opaque trace identity mismatch')
            violations = sum(event['tool'] == 'related_sessions' or event['tool'] == 'search_sessions' and
                (event['arguments']['mode'] != configuration['mode'] or event['arguments'].get('project') != configuration['project']) for event in trace)
            require(violations == outcome['conditionViolations'], 'recorded mode/project violation count mismatch')
            answer_path = directory / 'answer.json'; available = answer_path.exists()
            require(available == (native / 'answer.json').exists(), 'original/observed answer availability mismatch')
            if available:
                answer = recorded(answer_path); require(answer['taskId'] == opaque, 'opaque answer identity mismatch')
                require(sha(native / 'answer.json') == sha(answer_path), 'original/observed answer byte mismatch')
                if observed != original:
                    require(str((native / 'answer.json').resolve()) in lineage, 'sidecar answer source lineage missing')
            else:
                answer = {'taskId': opaque, 'facts': {'values': []}, 'abstain': False, 'citations': []}
            projected = [dict(event, taskId=task_id) for event in trace]
            assessment = proposition_support.assess(fixture, catalog['documents'], task, dict(answer, taskId=task_id), projected,
                dict(outcome, taskId=task_id), rubric, 5, principal=task['principal'], fixture_sha256=fixture_sha, answer_available=available)
            searches = [event for event in projected if event['tool'] == 'search_sessions']
            required = {catalog['documents'][key]['sessionId'] for key in task['relevant']}
            any_hits = {hit['session']['id'] for event in searches if 'result' in event for hit in event['result']['hits']}
            fixed = recorded(original / ('baseline-' + configuration['mode'] + '-' + task_id) / 'retrieval.json')
            fixed_ids = [hit['session']['id'] for hit in fixed['hits']]
            def recall(ids):
                return len(required.intersection(ids)) / len(required) if required else None
            complete = assessment['propositionEvidenceAvailable']
            assessment.update(mode=configuration['mode'], principal=task['principal'], originalControllerExit=controller['exit'],
                originalNativeState=outcome['state'], originalNativeFailure=outcome['failure'], sourceNativeFailure=terminal['failure'],
                originalControllerFailure=original_outcome['failure'], originalAnswerSha256=sha(answer_path) if available else None,
                originalInstanceId=run['instanceId'], originalRunId=run['runId'], modelOpaqueId=opaque,
                fixedRecallAt1=recall(fixed_ids[:1]), fixedRecallAt5=recall(fixed_ids[:5]),
                fixedAllRequiredAt5=required.issubset(fixed_ids[:5]) if required else None,
                fixedMrr=next((1 / index for index, sid in enumerate(fixed_ids[:5], 1) if sid in required), 0) if required else None,
                firstAttemptedSearchSucceeded=('result' in searches[0] if searches else None) if complete else None,
                firstAttemptedRecallAt5=recall([hit['session']['id'] for hit in searches[0]['result']['hits']][:5]) if complete and searches and 'result' in searches[0] else None,
                anyQueryRequiredCoverage=recall(any_hits) if complete else None, toolCalls=len(trace),
                source='same original model executions; additive criterion assessment, not a new trial or repaired original controller exit')
            results.append(assessment)
    expected = [(cell['mode'], cell['taskId']) for cell in schedule]
    require(len(expected) == len(set(expected)) and set(expected) == cells, 'observed cells do not match complete declared schedule')
    for name, expected_sha in list(inputs.items()):
        require(sha(Path(name)) == expected_sha, 'input hash changed before publication')
    summary = {'status': 'Assessed', 'assessmentPolicy': rubric['policy'], 'fixtureSha256': fixture_sha,
               'rubricSha256': inputs[str(args.rubric.resolve())], 'original': str(original), 'observed': str(observed), 'tasks': results}
    evaluate.save(output / 'summary.json', dict(summary, inputs=inputs))
    evaluate.save(output / 'input-manifest.json', inputs)
    print(json.dumps({'status': summary['status'], 'tasks': len(results), 'groundedV2': sum(item['groundedAnswerSuccessV2'] for item in results)}))


if __name__ == '__main__':
    main()
