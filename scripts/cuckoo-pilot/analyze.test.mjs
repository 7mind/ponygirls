import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { CASES, prompts } from './corpus.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'cuckoo-analysis-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const protocol = { sourceCommit: 'test', sourceHashes: {}, model: { contextWindow: 500000 }, plan: [{ task: 'triage', heldOut: false, length: 'short', arms: [true] }] };
  writeFileSync(join(directory, 'protocol.json'), JSON.stringify(protocol));
  const analyze = () => spawnSync(process.execPath, [join(import.meta.dirname, 'analyze.mjs'), directory], { encoding: 'utf8' });
  return { directory, analyze };
}
// Regression: termination before summary publication must remain analyzable, not disappear behind ENOENT.
test('analysis reports absent summary and missing runs explicitly instead of crashing', t => {
  const f = fixture(t); const result = f.analyze();
  assert.doesNotMatch(result.stderr, /ENOENT/);
  const analysis = JSON.parse(result.stdout); assert.equal(analysis.validCompletedPilot, false);
  assert.ok(analysis.faults.includes('summary-absent')); assert.deepEqual(analysis.missing, ['triage-short-on']);
});

test('failed secondary probe cannot erase an available completed primary deliverable', t => {
  const f = fixture(t); const id = 'triage-short-on'; mkdirSync(join(f.directory, id));
  const text = JSON.stringify({ scope: 'staging-only', incidents: [{ id: 'inc-42', priority: 'P0', owner: 'storage', requester: '[redacted]' }, { id: 'inc-45', priority: 'P1', owner: 'platform', requester: '[redacted]' }, { id: 'inc-41', priority: 'P1', owner: 'platform', requester: '[redacted]' }] });
  const run = { id, task: 'triage', length: 'short', enabled: true, status: 'failed', elapsedMs: 1000, reports: [], phases: [{ phase: 3, contextWindow: 500000, checkpointCount: 0 }], responses: [{ phase: 3, checkpoint: false, stopReason: 'stop', text, usageKnown: true, usage: { input: 100, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 200 } }], promptHashes: prompts(CASES[0], 'short').map(value => createHash('sha256').update(value).digest('hex')) };
  writeFileSync(join(f.directory, id, 'result.json'), JSON.stringify(run)); writeFileSync(join(f.directory, 'summary.json'), JSON.stringify({ results: [run] }));
  const result = f.analyze(); const analysis = JSON.parse(result.stdout);
  assert.equal(analysis.validCompletedPilot, false); assert.ok(analysis.faults.includes(`${id}:execution-failed`));
  assert.equal(analysis.pairs[0].onScore, 6); assert.equal(analysis.arms.find(arm => arm.enabled && arm.length === 'short').perfect, 1);
});
