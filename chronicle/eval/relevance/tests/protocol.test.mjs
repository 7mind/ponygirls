import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { appendPage, finalAnswer, uniformPrompt, conditionViolations, evaluationTrace } from '../live_protocol.mjs';
const identity = { instanceId: 'i', runId: 'r' };
const limits = { pageBytes: 65536, maximumEvents: 100, maximumTraceBytes: 65536 };
const answer = { taskId: 'opaque', facts: { values: ['4317'] }, abstain: false, citations: [] };
const response = { sequence: '1', item: { Response: { partIndex: 0, partCount: 1, textPart: JSON.stringify(answer) } } };
test('uniform ordered facts schema and explicit mode, no case oracle', () => {
  assert.deepEqual(finalAnswer([response], 'opaque'), answer);
  for (const mode of ['lexical', 'semantic', 'hybrid']) {
    const prompt = uniformPrompt({ id: 'opaque', question: 'Which port?' }, 'p', mode);
    assert.ok(prompt.includes(`Use ${mode} search only`));
    assert.ok(prompt.includes('values'));
    assert.ok(!prompt.includes('port, owner'));
  }
  assert.throws(() => uniformPrompt({ id: 'opaque', question: '?' }, 'p', undefined));
});
test('related and wrong mode/project are comparison violations without fallback', () => {
  const traces = [{ tool: 'related_sessions', arguments: {} },
    { tool: 'search_sessions', arguments: { mode: 'lexical', project: 'p' } },
    { tool: 'search_sessions', arguments: { mode: 'semantic', project: 'wrong' } }];
  assert.equal(conditionViolations(traces, 'semantic', 'p').length, 3);
  assert.equal(conditionViolations([{ tool: 'search_sessions', arguments: { mode: 'semantic', project: 'p' } }], 'semantic', 'p').length, 0);
});
test('terminal page drains to received high water, multipart complete and contiguous', () => {
  const page = { ...identity, events: [response], state: 'Complete', lastSequence: '2', hasMore: true };
  assert.equal(appendPage([], page, identity, limits).length, 1);
  assert.throws(() => appendPage([], { ...page, hasMore: false }, identity, limits));
  assert.throws(() => appendPage([], { ...page, events: [{ ...response, sequence: '2' }] }, identity, limits));
  assert.throws(() => appendPage([], { ...page, hasMore: false, lastSequence: '1', events: [
    { ...response, item: { Response: { partCount: 2, partIndex: 0, textPart: '{}' } } }] }, identity, limits));
});

const recorded = JSON.parse(readFileSync(new URL('./data/recorded-tool-pair.json', import.meta.url), 'utf8'));
test('recorded generated ToolResult joins by callId without a tool field', () => {
  assert.equal(Object.hasOwn(recorded[1].item.ToolResult, 'tool'), false);
  const trace = evaluationTrace(recorded, 'opaque');
  assert.equal(trace.length, 1);
  assert.equal(trace[0].tool, recorded[0].item.ToolCall.tool);
  assert.equal(trace[0].callId, recorded[1].item.ToolResult.callId);
  assert.deepEqual(trace[0].result, { hits: [], total: 0, countScope: 'ExactMatches', rankingLimit: null });
});
test('recorded call pairing rejects orphans, mismatched IDs and duplicate parts', () => {
  assert.throws(() => evaluationTrace([recorded[1]], 'opaque'), /orphan/);
  const mismatch = structuredClone(recorded); mismatch[1].item.ToolResult.callId = 'not-the-call';
  assert.throws(() => evaluationTrace(mismatch, 'opaque'), /orphan/);
  assert.throws(() => evaluationTrace([...recorded, recorded[1]], 'opaque'), /duplicate/);
  const invalid = structuredClone(recorded); invalid[0].item.ToolCall.tool = '';
  assert.throws(() => evaluationTrace([invalid[0]], 'opaque'), /ToolCall.tool/);
});

test('search expansion follows evidence gaps rather than hypothetical counterclaims', () => {
  const policy = 'Search results are candidates, not evidence that an answer exists. Use focused queries and small result pages; expand to follow a concrete relevant lead, obtain a missing requested fact or resolve an observed contradiction. Once original source messages explicitly support the requested facts, answer; do not keep searching solely to rule out hypothetical counterclaims or global absence.';
  for (const mode of ['lexical', 'semantic', 'hybrid']) {
    const prompt = uniformPrompt({ id: 'opaque', question: 'Which owner and time?' }, 'p', mode);
    assert.ok(prompt.includes(policy));
  }
});

test('uniform abstention reports insufficient found evidence, not global absence', () => {
  const instruction = 'If the evidence you found does not support the requested answer, return facts:{"values":[]}, abstain:true, citations:[]. This reports insufficient supporting evidence found, not proof of global absence. Otherwise abstain:false and cite every asserted fact. Do not include prose or Markdown fences.';
  for (const mode of ['lexical', 'semantic', 'hybrid']) {
    for (const task of [{ id: 'opaque-a', question: 'Which port?' }, { id: 'opaque-b', question: 'Which owner?' }]) {
      const lines = uniformPrompt(task, 'p', mode).split('\n');
      assert.equal(lines[6], instruction);
      assert.ok(!lines.some(line => line.includes('If no accessible supporting evidence exists')));
    }
  }
});
