import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { stream as streamAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages';
import { registerCuckoo } from '../index.ts';

const raw = JSON.stringify({ objectives: [{ objective: 'Ship recall', progress: 'Testing', issues: ['Validation'], eta: 'Unknown: tests pending' }], rules: [{ rule: 'Review before merging', source: 'assistant', scope: 'This change' }] });
function fixture() {
  const manager = SessionManager.inMemory(); const tools = new Map(); const handlers = new Map();
  const preferences = { path: 'memory:cuckoo', read: () => ({ enabled: false, policy: { kind: 'window', value: 15 } }), write() { assert.fail('recall must not write preferences'); } };
  const pi = { registerTool: tool => tools.set(tool.name, tool), on: (name, fn) => handlers.set(name, fn), registerCommand() {}, registerShortcut() {},
    sendMessage() { assert.fail('recall must not request inference'); }, appendEntry() { assert.fail('recall must not append entries'); } };
  const ctx = { sessionManager: manager, ui: { notify() {} } };
  registerCuckoo(pi, preferences);
  const call = async params => {
    const tool = tools.get('cuckoo_recall'); assert.ok(tool, 'cuckoo_recall must be registered');
    const result = await tool.execute('recall-call', params, undefined, undefined, ctx);
    assert.deepEqual(JSON.parse(result.content[0].text), result.details);
    assert.ok(Buffer.byteLength(result.content[0].text) <= 50000, 'bounded model response');
    assert.equal(result.details.sessionId, manager.getSessionId());
    assert.match(result.details.notice, /historical|self-reports/i);
    assert.match(result.details.notice, /authorization/i);
    return result.details;
  };
  const save = (requestId, text = raw, error = null, version = 4, extra = {}) => manager.appendCustomEntry('cuckoo.report', { version, requestId, raw: text, error, ...extra });
  return { manager, tools, handlers, ctx, preferences, call, save };
}
async function readAll(f, entryId, scope) {
  let text = ''; let offset = 0;
  do {
    const page = await f.call({ action: 'read', entryId, scope, offset, limit: 127 });
    assert.equal(page.offset, offset); assert.equal(page.format, 'json');
    text += page.text; offset = page.nextOffset;
    if (offset === null) assert.equal(text.length, page.totalChars);
  } while (offset !== null);
  return JSON.parse(text);
}

// Specified Behavioral-Active / Blackbox-Group: public tool and hooks over a real in-memory session tree.
test('registers a read-only recall tool that is available while automatic inquiries are off', async () => {
  const f = fixture(); const result = await f.call({ action: 'list' });
  assert.equal(result.scope, 'branch'); assert.equal(result.total, 0); assert.deepEqual(result.rounds, []); assert.equal(result.nextBefore, null);
  assert.deepEqual(f.tools.get('cuckoo_recall').annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
});

// BG regression: scripted model loops bypass provider schema conversion.
test('Anthropic payload retains recall action and arguments without making a network request', async () => {
  const f = fixture(); const tool = f.tools.get('cuckoo_recall');
  const model = { id: 'claude-sonnet-4-20250514', name: 'Fixture', api: 'anthropic-messages', provider: 'anthropic', baseUrl: 'https://fixture.invalid', reasoning: false, input: ['text'], contextWindow: 200000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let payload; let fetches = 0;
  const result = await streamAnthropic(model, { messages: [
    { role: 'system', content: 'Test tool declaration', toolsAdded: [tool], timestamp: 1 },
    { role: 'user', content: 'List reflections', timestamp: 2 },
  ] }, { apiKey: 'fixture-only', maxRetries: 0,
    fetch() { fetches++; throw new Error('Network must not be used'); },
    onPayload(value) { payload = value; throw new Error('Intentional stop after payload capture'); },
  }).result();
  assert.equal(fetches, 0); assert.match(result.errorMessage, /Intentional stop/);
  const schema = payload.tools.find(item => item.name === 'cuckoo_recall').input_schema;
  assert.equal(schema.type, 'object');
  assert.deepEqual(Object.keys(schema.properties).sort(), ['action', 'before', 'entryId', 'limit', 'offset', 'scope']);
  assert.deepEqual(schema.required, ['action']);
  assert.equal(tool.parameters.anyOf, undefined, 'provider-compatible root object, not a root union');
});

test('list defaults to current branch and session scope explicitly labels other branches', async () => {
  const f = fixture(); const root = f.manager.appendCustomEntry('root', {});
  const other = f.save('other-round'); f.manager.branch(root);
  const current = f.save('current-round', 'partial reply', 'Interrupted');
  const before = f.manager.getEntries(); const leaf = f.manager.getLeafId();
  const branch = await f.call({ action: 'list' });
  assert.deepEqual(branch.rounds.map(r => r.entryId), [current]);
  assert.equal(branch.rounds[0].branch, 'current'); assert.equal(branch.rounds[0].status, 'invalid');
  assert.equal(branch.rounds[0].objectiveCount, null); assert.equal(branch.rounds[0].ruleCount, null);
  const all = await f.call({ action: 'list', scope: 'session' });
  assert.deepEqual(all.rounds.map(r => r.entryId), [current, other]); assert.equal(all.rounds[1].branch, 'other');
  assert.equal(all.rounds[1].requestId, 'other-round'); assert.equal(all.rounds[1].objectiveCount, 1); assert.equal(all.rounds[1].ruleCount, 1);
  assert.equal(all.rounds[1].timestamp, f.manager.getEntry(other).timestamp);
  await assert.rejects(f.call({ action: 'read', entryId: other }), /not found.*scope/i);
  assert.deepEqual((await readAll(f, other, 'session')).report, JSON.parse(raw));
  assert.deepEqual(f.manager.getEntries(), before); assert.equal(f.manager.getLeafId(), leaf);
});

test('cursor pagination stays stable when a newer round is saved and rejects missing or out-of-scope cursors', async () => {
  const f = fixture(); const root = f.manager.appendCustomEntry('root', {}); const ids = [];
  for (let i = 0; i < 25; i++) ids.push(f.save(`round-${i}`));
  const first = await f.call({ action: 'list', limit: 10 });
  assert.deepEqual(first.rounds.map(r => r.entryId), ids.slice(15).reverse()); assert.equal(first.nextBefore, ids[15]);
  f.save('new-after-first-page');
  const second = await f.call({ action: 'list', before: first.nextBefore, limit: 20 });
  assert.deepEqual(second.rounds.map(r => r.entryId), ids.slice(0, 15).reverse()); assert.equal(second.nextBefore, null);
  const end = await f.call({ action: 'list', before: ids[0] }); assert.deepEqual(end.rounds, []);
  await assert.rejects(f.call({ action: 'list', before: 'missing' }), /cursor.*not found/i);
  f.manager.branch(root); await assert.rejects(f.call({ action: 'list', before: ids[0] }), /cursor.*not found/i);
});

test('read preserves exact raw text, validation failure and legacy unknown fields rather than inventing values', async () => {
  const f = fixture();
  const legacy = f.save('legacy', '{"objectives":[{"objective":"Earlier work","progress":"Pending"}]}', null, 1);
  const old = { objective: 'Earlier work', progress: 'Testing', obstacles: 'None known', issues: 'A defect', bottlenecks: 'Serial', eta: 'Unknown' };
  const v2 = f.save('v2', JSON.stringify({ objectives: [old] }), null, 2);
  const v3Raw = JSON.stringify({ objectives: [old], rules: [] });
  const v3 = f.save('v3', v3Raw, null, 3);
  const invalid = f.save('invalid', 'not JSON\n\u001b literal 🐦', null);
  const interrupted = f.save('interrupted', raw, 'Interrupted');
  const legacyBody = await readAll(f, legacy, 'branch');
  assert.equal(legacyBody.version, 1); assert.equal(legacyBody.report.objectives[0].eta, null); assert.equal(legacyBody.report.rules, null);
  assert.equal((await readAll(f, v2, 'branch')).report.rules, null);
  const v3Body = await readAll(f, v3, 'branch');
  assert.equal(v3Body.raw, v3Raw); assert.equal(v3Body.version, 3);
  assert.deepEqual(v3Body.report.objectives[0].issues, ['Obstacles (legacy): None known', 'Issues (legacy): A defect', 'Bottlenecks (legacy): Serial']);
  const invalidBody = await readAll(f, invalid, 'branch');
  assert.equal(invalidBody.raw, 'not JSON\n\u001b literal 🐦'); assert.equal(invalidBody.report, null); assert.match(invalidBody.error, /SyntaxError/);
  const interruptedBody = await readAll(f, interrupted, 'branch'); assert.equal(interruptedBody.raw, raw); assert.equal(interruptedBody.report, null); assert.equal(interruptedBody.error, 'Interrupted');
});

test('read links the source response without exposing thinking or other stored content', async () => {
  const f = fixture();
  const content = [{ type: 'thinking', thinking: 'PRIVATE_THINKING_NOT_A_REFLECTION' }, { type: 'text', text: raw }];
  const messageEntryId = f.manager.appendMessage({ role: 'assistant', content, provider: 'fixture', model: 'original-model', api: 'openai-completions', stopReason: 'stop', timestamp: 1 });
  const entryId = f.save('source-linked', raw, null, 4, { messageEntryId, content });
  const list = await f.call({ action: 'list' }); assert.equal(list.rounds[0].messageEntryId, messageEntryId);
  const body = await readAll(f, entryId, 'branch');
  assert.equal(body.response.provider, 'fixture'); assert.equal(body.response.model, 'original-model'); assert.equal(body.messageEntryId, messageEntryId);
  assert.equal(body.raw, raw); assert.doesNotMatch(JSON.stringify(body), /PRIVATE_THINKING/);
  assert.equal((await readAll(f, f.save('no-source'), 'branch')).response, null);
});

test('read pages reconstruct long escaped and Unicode output exactly within the response byte bound', async () => {
  const f = fixture(); const text = '\u0000\\\n🐦'.repeat(10000); const entryId = f.save('large-invalid', text, 'Malformed');
  let combined = ''; let offset = 0;
  do {
    const page = await f.call({ action: 'read', entryId, offset, limit: 8000 });
    combined += page.text; offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(JSON.parse(combined).raw, text);
  const end = await f.call({ action: 'read', entryId, offset: combined.length }); assert.equal(end.text, ''); assert.equal(end.nextOffset, null);
  await assert.rejects(f.call({ action: 'read', entryId, offset: combined.length + 1 }), /offset/i);
});

test('invalid limits, identifiers and persisted envelopes fail explicitly without silently dropping rounds', async () => {
  const f = fixture(); const entryId = f.save('valid');
  for (const limit of [0, -1, 21, 1.5, NaN, Infinity]) await assert.rejects(f.call({ action: 'list', limit }), /limit/i);
  for (const limit of [0, -1, 8001, 1.5, NaN, Infinity]) await assert.rejects(f.call({ action: 'read', entryId, limit }), /limit/i);
  for (const offset of [-1, 1.5, NaN, Infinity]) await assert.rejects(f.call({ action: 'read', entryId, offset }), /offset/i);
  await assert.rejects(f.call({ action: 'read', entryId: 'missing' }), /not found.*scope/i);
  await assert.rejects(f.call({ action: 'read' }), /requires entryId/i);
  await assert.rejects(f.call({ action: 'list', entryId }), /does not accept/i);
  await assert.rejects(f.call({ action: 'list', offset: 0 }), /does not accept/i);
  await assert.rejects(f.call({ action: 'read', entryId, before: entryId }), /does not accept/i);
  f.manager.appendCustomEntry('cuckoo.report', { version: 999, raw: '', error: null, requestId: 'unsupported' });
  await assert.rejects(f.call({ action: 'list' }), /Invalid saved Cuckoo/);
});

test('recall remains available with invalid settings, after compaction, and uses the current tree on every call', async () => {
  const f = fixture(); const root = f.manager.appendCustomEntry('root', {}); const entryId = f.save('survives-compaction');
  const kept = f.manager.appendMessage({ role: 'user', content: 'Continue', timestamp: 1 });
  f.manager.appendCompaction('Summary without the report', kept, 10000);
  f.preferences.read = () => { throw new Error('Invalid settings'); };
  assert.equal((await f.call({ action: 'list' })).rounds[0].entryId, entryId);
  assert.equal((await readAll(f, entryId, 'branch')).raw, raw);
  f.manager.branch(root); assert.equal((await f.call({ action: 'list' })).total, 0);
  assert.equal((await f.call({ action: 'list', scope: 'session' })).rounds[0].branch, 'other');
  const fresh = SessionManager.inMemory(); f.ctx.sessionManager = fresh;
  const result = await f.tools.get('cuckoo_recall').execute('fresh', { action: 'list' }, undefined, undefined, f.ctx);
  assert.equal(result.details.total, 0); assert.equal(result.details.sessionId, fresh.getSessionId());
});

test('a fork exposes only the copied path, not the parent session other branches', async () => {
  const f = fixture(); const root = f.manager.appendCustomEntry('root', {}); const other = f.save('excluded-parent-round');
  f.manager.branch(root); const copied = f.save('copied-round'); const parentSessionId = f.manager.getSessionId();
  f.manager.createBranchedSession(copied);
  assert.notEqual(f.manager.getSessionId(), parentSessionId);
  const result = await f.call({ action: 'list', scope: 'session' }); assert.deepEqual(result.rounds.map(round => round.entryId), [copied]);
  await assert.rejects(f.call({ action: 'read', scope: 'session', entryId: other }), /not found.*scope/i);
});

test('oversized metadata fails explicitly rather than emitting an unbounded result', async () => {
  const f = fixture(); const entryId = f.save('x'.repeat(50000));
  await assert.rejects(f.call({ action: 'list' }), /metadata.*size limit/i);
  await assert.rejects(f.call({ action: 'read', entryId }), /metadata.*size limit/i);
});

test('model guidance declares cadence, current enablement and historical authority boundaries without replacing other sections', () => {
  const f = fixture();
  const event = { messageType: 'custom', systemPromptOptions: { sections: { existing: 'keep me' } } };
  f.handlers.get('before_agent_start')(event, f.ctx);
  const text = event.systemPromptOptions.sections.cuckoo;
  assert.match(text, /OFF/); assert.match(text, /self-reflection/); assert.match(text, /context.*growth/i); assert.match(text, /not a timer/);
  assert.match(text, /cuckoo_recall/); assert.match(text, /JSON.only/); assert.match(text, /not.*authorization/i);
  assert.equal(event.systemPromptOptions.sections.existing, 'keep me');
  f.preferences.read = () => ({ enabled: true, policy: { kind: 'tokens', value: 12345 } });
  f.handlers.get('before_agent_start')(event, f.ctx); assert.match(event.systemPromptOptions.sections.cuckoo, /ON.*12345/);
  f.preferences.read = () => { throw new Error('settings failed'); };
  f.handlers.get('before_agent_start')(event, f.ctx); assert.match(event.systemPromptOptions.sections.cuckoo, /unavailable/i);
  assert.doesNotMatch(event.systemPromptOptions.sections.cuckoo, /\b(?:ON|OFF)\b/);
});
