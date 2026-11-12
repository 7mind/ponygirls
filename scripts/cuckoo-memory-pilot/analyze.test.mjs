import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze as analyzeResults } from './analyze.mjs';
const analyze = (output, phase) => analyzeResults(output, phase, process.env.PI_PILOT_PROVIDER_CONFIG);
import { createProtocol } from './protocol.mjs';
import { getCase } from './cases.mjs';
import { assistantRecords, hash, reportInventory } from './memory.mjs';

const GOOD = JSON.stringify({ slot: 'Wed09', attendees: ['Q', 'R'], retire: ['M0'], sources: ['meeting-roster-amendment-r2', 'meeting-facilities-correction-r2', 'meeting-availability-amendment-r2'] });
const BAD = JSON.stringify({ slot: 'Mon09', attendees: ['P', 'R'], retire: [], sources: ['meeting-request-r1'] });
const timestamp = '2026-11-12T18:00:00Z';
const assistant = (id, text) => ({ type: 'message', id, parentId: null, timestamp, message: { role: 'assistant', content: [{ type: 'text', text }], provider: 'openai-codex', model: 'gpt-6.1-sol', stopReason: 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } } });

function fixture(t, nativeText) {
  const output = mkdtempSync(join(tmpdir(), 'cuckoo-pilot-analysis-')); t.after(() => rmSync(output, { recursive: true, force: true }));
  const protocol = createProtocol(process.env.PI_SDK_ROOT, process.env.PI_CUCKOO_EXTENSION, process.env.PI_PILOT_PROVIDER_CONFIG);
  const job = protocol.plan.scored.find(job => job.caseId === 'meeting' && job.writing === 'current' && job.provider === 'openai-codex');
  const arm = job.continuations[0];
  writeFileSync(join(output, 'protocol.json'), JSON.stringify(protocol));
  const folder = join(output, 'scored', job.id); mkdirSync(folder, { recursive: true });
  const entries = [assistant('revised', GOOD)];
  for (let i = 0; i < 4; i++) {
    const raw = '{"objectives":[],"rules":[]}'; entries.push(assistant(`a${i}`, raw));
    entries.push({ type: 'custom', customType: 'cuckoo.report', id: `r${i}`, parentId: `a${i}`, timestamp, data: { version: 4, requestId: `request-${i}`, raw, report: { objectives: [], rules: [] }, error: null, messageEntryId: `a${i}` } });
  }
  const prefixPath = join(folder, 'prefix.jsonl'); writeFileSync(prefixPath, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const reports = reportInventory(entries); const finalEntry = assistant('final', nativeText);
  const finalUser = { type: 'message', id: 'final-user', timestamp, parentId: null, message: { role: 'user', content: getCase(job.caseId).finalPrompt, timestamp: 1 } };
  const finalPath = join(folder, 'final.jsonl'); writeFileSync(finalPath, [...entries, finalUser, finalEntry].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const final = assistantRecords([finalEntry], new Set(), 'final')[0];
  const result = { job, inferenceKind: 'live', caseInputHash: job.caseInputHash, model: { provider: job.provider, id: job.model, thinking: job.thinking },
    prefix: { status: 'completed', sessionFile: prefixPath, sessionSha256: hash(readFileSync(prefixPath)), reportSetHash: hash(reports), reports, revised: assistantRecords([entries[0]], new Set(), 'update')[0], requests: [], responses: [], elapsedMs: 1, deltaInjections: 0 },
    continuations: [{ id: `${job.id}-${arm.id}`, arm, status: 'completed', final, reports, reportSetHashBefore: hash(reports), sessionFile: finalPath, sessionSha256: hash(readFileSync(finalPath)), requests: [], responses: [final], toolCalls: [], elapsedMs: 1 }] };
  const resultPath = join(folder, 'result.json');
  const save = () => writeFileSync(resultPath, JSON.stringify(result)); save();
  return { output, job, arm, result, resultPath, save, finalPath, row: analysis => analysis.rows.find(row => row.id === `${job.id}/${arm.id}`) };
}

test('analysis retains all planned rows and available primary output without a summary', t => {
  const f = fixture(t, GOOD); const result = analyze(f.output, 'scored');
  assert.equal(result.rows.length, 96); assert.equal(f.row(result).perfect, true);
  assert.ok(result.faults.some(fault => fault.includes('Phase status missing')));
  assert.ok(result.rows.some(row => row.status === 'not-run-or-unavailable'));
});

test('supervisor receipt detects replaced execution/resource metadata', t => {
  const f = fixture(t, GOOD);
  const protocolHash = hash(readFileSync(join(f.output, 'protocol.json')));
  writeFileSync(join(f.output, 'scored-status.json'), JSON.stringify({ protocolHash, status: 'completed', jobs: [{ id: f.job.id, status: 'completed', exitCode: 0, resultSha256: hash(readFileSync(f.resultPath)) }] }));
  f.result.continuations[0].elapsedMs = 99999; f.result.continuations[0].requests = [{}, {}, {}]; f.save();
  const result = analyze(f.output, 'scored');
  assert.equal(f.row(result).evidenceBound, false);
  assert.ok(result.faults.some(fault => fault.includes('receipt')));
});

test('native response binding rejects a replaced result-copy answer', t => {
  const f = fixture(t, BAD); f.result.continuations[0].final.text = GOOD; f.save();
  const result = analyze(f.output, 'scored');
  assert.equal(f.row(result).evidenceBound, false); assert.equal(f.row(result).perfect, false);
});

test('native report binding rejects a replaced reflection inventory', t => {
  const f = fixture(t, GOOD);
  f.result.prefix.reports[0].raw = '{"objectives":[],"rules":[{"rule":"forged","source":"user","scope":"all"}]}';
  f.result.prefix.reportSetHash = hash(f.result.prefix.reports); f.result.continuations[0].reportSetHashBefore = f.result.prefix.reportSetHash; f.save();
  assert.equal(f.row(analyze(f.output, 'scored')).evidenceBound, false);
});

test('retrieval metrics come from native tool results, not a replaceable trace copy', t => {
  const f = fixture(t, GOOD);
  f.result.continuations[0].toolCalls.push({ name: 'cuckoo_search', args: { query: 'meeting' }, isError: false, outputChars: 99999 }); f.save();
  const row = f.row(analyze(f.output, 'scored'));
  assert.equal(row.memoryCalls, 0); assert.equal(row.returnedToolChars, 0);
});

test('analysis reports tampered native artifacts and tolerates failed calls with unavailable arguments', t => {
  const f = fixture(t, GOOD);
  f.result.continuations[0].toolCalls.push({ name: 'cuckoo_recall', args: null, isError: true, outputChars: 10 });
  const entries = readFileSync(f.finalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  entries.splice(-1, 0, { type: 'message', id: 'failed-tool', timestamp, parentId: null, message: { role: 'toolResult', toolName: 'cuckoo_recall', toolCallId: 'bad-args', content: [{ type: 'text', text: 'Bad input' }], isError: true, timestamp: 1 } });
  writeFileSync(f.finalPath, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  f.result.continuations[0].sessionSha256 = hash(readFileSync(f.finalPath)); f.save();
  const intact = analyze(f.output, 'scored'); assert.equal(f.row(intact).toolErrors, 1);
  writeFileSync(f.finalPath, 'tampered\n');
  const changed = analyze(f.output, 'scored'); assert.equal(f.row(changed).evidenceBound, false);
  assert.ok(changed.faults.some(fault => fault.includes('Continuation')));
});
