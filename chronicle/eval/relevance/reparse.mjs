import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { appendPage, conditionViolations, evaluationTrace, finalAnswer, terminal } from './live_protocol.mjs';

const { values } = parseArgs({ options: { source: { type: 'string' }, out: { type: 'string' } } });
assert.ok(values.source && values.out, 'required: --source ORIGINAL_BATCH --out FRESH_SIDECARS');
process.umask(0o077);
const source = realpathSync(values.source), requestedOutput = resolve(values.out);
const output = join(realpathSync(dirname(requestedOutput)), basename(requestedOutput));
const inside = (parent, child) => { const path = relative(parent, child); return path === '' || !isAbsolute(path) && path !== '..' && !path.startsWith('../'); };
assert.ok(!inside(source, output) && !inside(output, source), 'sidecars must be disjoint from originals');
mkdirSync(output, { mode: 0o700 });
const hashes = new Map();
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const read = path => {
  const bytes = readFileSync(path); hashes.set(path, createHash('sha256').update(bytes).digest('hex'));
  return JSON.parse(bytes.toString('utf8'));
};
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const parserFiles = [fileURLToPath(import.meta.url), fileURLToPath(new URL('./live_protocol.mjs', import.meta.url))];
const parserSources = Object.fromEntries(parserFiles.map(path => [path, hash(path)]));
mkdirSync(join(output, 'parser-source'), { mode: 0o700 });
for (const path of parserFiles) {
  const target = join(output, 'parser-source', basename(path)); copyFileSync(path, target);
  assert.equal(hash(target), parserSources[path], 'parser source changed during snapshot');
}
const groups = readdirSync(source, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith('agent-')).map(entry => entry.name).sort();
assert.ok(groups.length > 0, 'no captured agent groups');
const results = [];
for (const group of groups) {
  const originalGroup = join(source, group), sidecarGroup = join(output, group);
  mkdirSync(sidecarGroup, { mode: 0o700 });
  const input = read(join(originalGroup, 'input.json'));
  const catalog = read(join(originalGroup, 'catalog.json'));
  const mapping = read(join(originalGroup, 'evaluator-private-map.json'));
  const controller = read(join(originalGroup, 'client-exit.json'));
  for (const [opaque, evaluatorId] of Object.entries(mapping)) {
    assert.ok(opaque === basename(opaque) && !['.', '..'].includes(opaque), 'invalid opaque directory identity');
    const original = join(originalGroup, opaque), sidecar = join(sidecarGroup, opaque);
    mkdirSync(sidecar, { mode: 0o700 });
    let result = { group, taskId: opaque, evaluatorTaskId: evaluatorId, mode: input.mode, originalControllerExit: controller.exit,
      nativeState: null, nativeFailure: null, traceAvailable: false, answerAvailable: false, reparseFailure: null };
    try {
      assert.ok(input.tasks.some(task => task.id === opaque), 'opaque identity absent from original controller input');
      const run = read(join(original, 'run.json')), originalOutcome = read(join(original, 'outcome.json'));
      assert.equal(run.taskId, opaque); assert.equal(originalOutcome.taskId, opaque);
      const identity = { instanceId: run.instanceId, runId: run.runId };
      const recorded = read(join(original, 'events.json'));
      const pageNames = readdirSync(original).filter(name => /^page-\d+\.json$/.test(name)).sort();
      assert.ok(pageNames.length > 0, 'no original protocol pages');
      let events = [], last;
      for (const [number, name] of pageNames.entries()) {
        assert.equal(Number(name.slice(5, -5)), number, 'missing or duplicate page number');
        last = read(join(original, name));
        events = appendPage(events, last, identity, catalog.limits);
      }
      assert.ok(terminal(last.state) && !last.hasMore, 'original trace was not fully terminal-drained');
      assert.equal(last.state, originalOutcome.state, 'native terminal state differs from original outcome');
      assert.deepEqual(events, recorded, 'raw events differ from validated original pages');
      result.nativeState = last.state; result.nativeFailure = last.failure;
      const observed = evaluationTrace(events, opaque);
      writeFileSync(join(sidecar, 'trace.jsonl'), observed.map(event => JSON.stringify(event)).join('\n') + (observed.length ? '\n' : ''), { flag: 'wx', mode: 0o600 });
      result.traceAvailable = true;
      let answerFailure = null;
      if (last.state === 'Complete') {
        try {
          const answer = finalAnswer(events, opaque), originalAnswer = join(original, 'answer.json');
          if (existsSync(originalAnswer)) {
            assert.deepEqual(read(originalAnswer), answer, 'derived answer differs from retained original answer');
            copyFileSync(originalAnswer, join(sidecar, 'answer.json'));
            assert.equal(hash(originalAnswer), hash(join(sidecar, 'answer.json')));
            result.originalAnswerSha256 = hashes.get(originalAnswer);
          } else save(join(sidecar, 'answer.json'), answer);
          result.answerAvailable = true;
        } catch (error) { answerFailure = { type: 'final-output-failed', message: String(error) }; }
      }
      const failure = last.state === 'Complete' ? answerFailure : { type: 'model-run-failed', state: last.state, failure: last.failure };
      const violations = conditionViolations(observed, input.mode, input.project);
      save(join(sidecar, 'outcome.json'), { taskId: opaque, mode: input.mode, state: last.state, failure,
        terminalUnconfirmed: false, traceComplete: true, conditionViolations: violations.length,
        events: events.length, toolCalls: observed.length, originalControllerExit: controller.exit,
        originalControllerOutcomeSha256: hashes.get(join(original, 'outcome.json')), originalControllerFailure: originalOutcome.failure,
        normalizationReparsed: true, claim: 'offline normalization of original model run; NOT a new execution or repaired original controller exit' });
      save(join(sidecar, 'condition-violations.json'), violations);
    } catch (error) {
      result.reparseFailure = { type: error.constructor.name, message: String(error) };
      save(join(sidecar, 'reparse-failure.json'), result.reparseFailure);
    }
    save(join(sidecar, 'reparse.json'), result); results.push(result);
  }
}
for (const [path, expected] of hashes) assert.equal(hash(path), expected, 'original input changed during reparse: ' + path);
for (const [path, expected] of Object.entries(parserSources)) assert.equal(hash(path), expected, 'parser source changed during reparse');
save(join(output, 'source-manifest.json'), { originalFiles: Object.fromEntries(hashes), parserSources });
const summary = { status: results.some(result => result.reparseFailure !== null) ? 'ReparseIncomplete' : 'Reparsed',
  source, tasks: results, originalRunCount: results.length,
  nativeComplete: results.filter(result => result.nativeState === 'Complete').length,
  nativeFailed: results.filter(result => result.nativeState === 'Failed').length,
  traceAvailable: results.filter(result => result.traceAvailable).length,
  answerAvailable: results.filter(result => result.answerAvailable).length,
  claim: 'model-free sidecars from immutable captured pages/events; native failures and original controller exits retained' };
save(join(output, 'summary.json'), summary);
console.log(JSON.stringify({ status: summary.status, originalRunCount: summary.originalRunCount, nativeComplete: summary.nativeComplete,
  nativeFailed: summary.nativeFailed, traceAvailable: summary.traceAvailable, answerAvailable: summary.answerAvailable, output }));
if (summary.status !== 'Reparsed') process.exitCode = 2;
