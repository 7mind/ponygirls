import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../reparse.mjs', import.meta.url));
const pair = JSON.parse(readFileSync(new URL('./data/recorded-tool-pair.json', import.meta.url), 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value) + '\n');
function inventory(path) {
  return readdirSync(path, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
    const file = join(entry.parentPath, entry.name);
    return [file, createHash('sha256').update(readFileSync(file)).digest('hex')];
  }).sort((a, b) => a[0].localeCompare(b[0]));
}
function captured(root, name, state) {
  const group = join(root, name), run = join(group, 'opaque'); mkdirSync(run, { recursive: true });
  const nativeFailure = state === 'Failed' ? { code: 'mcp-context-limit', message: 'no retry' } : null;
  const answer = { taskId: 'opaque', facts: { values: [] }, abstain: true, citations: [] };
  const events = structuredClone(pair);
  if (state === 'Complete') events.push({ sequence: '3', item: { Response: { partIndex: 0, partCount: 1, textPart: JSON.stringify(answer) } } });
  save(join(group, 'input.json'), { tasks: [{ id: 'opaque', question: '?' }], mode: 'semantic', project: JSON.parse(pair[0].item.ToolCall.argumentsJsonPart).project });
  save(join(group, 'catalog.json'), { limits: { pageBytes: 65536, maximumEvents: 100, maximumTraceBytes: 65536 } });
  save(join(group, 'evaluator-private-map.json'), { opaque: 'q01' }); save(join(group, 'client-exit.json'), { exit: 1 });
  save(join(run, 'run.json'), { taskId: 'opaque', instanceId: 'instance', runId: 'run' });
  save(join(run, 'outcome.json'), { taskId: 'opaque', state, failure: { type: 'trace-normalization-failed', message: 'old parser',
    priorFailure: nativeFailure === null ? null : { type: 'model-run-failed', state, failure: nativeFailure } } });
  save(join(run, 'events.json'), events);
  save(join(run, 'page-0000.json'), { instanceId: 'instance', runId: 'run', events, state, failure: nativeFailure,
    lastSequence: String(events.length), hasMore: false });
  if (state === 'Complete') save(join(run, 'answer.json'), answer);
}
test('offline CLI repairs recorded schema while preserving native failure and original bytes', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'relevance-reparse-'));
  try {
    const source = join(temporary, 'source'), output = join(temporary, 'sidecars'); mkdirSync(source);
    captured(source, 'agent-semantic-q01', 'Complete'); captured(source, 'agent-hybrid-q03', 'Failed');
    const before = inventory(source);
    const process = spawnSync(globalThis.process.execPath, [cli, '--source', source, '--out', output], { encoding: 'utf8' });
    assert.equal(process.status, 0, process.stderr);
    const summary = JSON.parse(readFileSync(join(output, 'summary.json'), 'utf8'));
    assert.equal(summary.traceAvailable, 2); assert.equal(summary.answerAvailable, 1);
    assert.equal(summary.nativeComplete, 1); assert.equal(summary.nativeFailed, 1);
    const failed = JSON.parse(readFileSync(join(output, 'agent-hybrid-q03/opaque/outcome.json'), 'utf8'));
    assert.equal(failed.state, 'Failed'); assert.equal(failed.failure.failure.code, 'mcp-context-limit');
    assert.equal(failed.originalControllerExit, 1);
    assert.equal(existsSync(join(output, 'agent-hybrid-q03/opaque/answer.json')), false);
    assert.deepEqual(inventory(source), before);
    assert.deepEqual(readFileSync(join(source, 'agent-semantic-q01/opaque/answer.json')),
      readFileSync(join(output, 'agent-semantic-q01/opaque/answer.json')));
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
test('offline CLI rejects output within originals before creating it', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'relevance-reparse-'));
  try {
    const output = join(temporary, 'nested');
    const process = spawnSync(globalThis.process.execPath, [cli, '--source', temporary, '--out', output], { encoding: 'utf8' });
    assert.notEqual(process.status, 0); assert.equal(existsSync(output), false);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
