// Specified Behavioral-Active/Blackbox-Group; real protocol helpers, no provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expectedToolsV3, verifyCatalogV3, uniformPromptV3 } from '../agent_protocol_v3.mjs';
import { evaluationTrace, finalAnswer } from '../live_protocol.mjs';
const recordedCatalog = () => JSON.parse(readFileSync(new URL('./data/recorded-agent-catalog.json', import.meta.url), 'utf8')).catalog;
const bindings = catalog => ({ agentReasoningPolicy: catalog.reasoningPolicy, agentMaximumOutputTokens: catalog.maximumOutputTokens,
  agentRevision: catalog.modelRevision, agentModel: catalog.model });

test('recorded native baseline catalog preserves all eleven exact comparison limits', () => {
  const catalog = recordedCatalog(), input = bindings(catalog);
  verifyCatalogV3(catalog, input, 'baseline');
  assert.equal(Object.keys(catalog.limits).length, 11);
  for (const key of Object.keys(catalog.limits)) {
    for (const delta of [-1, 1]) {
      const altered = structuredClone(catalog); altered.limits[key] += delta;
      assert.throws(() => verifyCatalogV3(altered, input, 'baseline'), key);
    }
    const missing = structuredClone(catalog); delete missing.limits[key];
    assert.throws(() => verifyCatalogV3(missing, input, 'baseline'), `missing ${key}`);
  }
  assert.throws(() => verifyCatalogV3({ ...catalog, limits: { ...catalog.limits, unknownLimit: 1 } }, input, 'baseline'));
});

test('explicit versioned catalogs use the recorded baseline rather than invented limit metadata', () => {
  assert.equal(expectedToolsV3('baseline').length, 9);
  assert.equal(expectedToolsV3('context').length, 10);
  assert.throws(() => expectedToolsV3('unknown'));
  const catalog = recordedCatalog(), input = bindings(catalog);
  // Only the new tool name is synthetic; all comparison limit metadata is recorded.
  const contextCatalog = { ...catalog, tools: [...catalog.tools, { name: 'read_message_context' }] };
  verifyCatalogV3(contextCatalog, input, 'context');
  assert.throws(() => verifyCatalogV3(contextCatalog, input, 'baseline'));
  assert.throws(() => verifyCatalogV3({ ...catalog, tools: [...catalog.tools, { name: 'delete_session' }] }, input, 'baseline'));
});
test('uniform prompt carries no evaluator fields, keeps existing policy and exact pin navigation', () => {
  const prompt = uniformPromptV3({ id: 'opaque-random', question: 'Which port?' }, 'project', 'lexical');
  for (const text of ['lexical search only', 'never use another search mode or related_sessions', 'read_message_context', 'hit.session.view',
    'facts must be exactly {"values":[string,...]}', 'do not keep searching solely', 'abstain:true']) assert.ok(prompt.includes(text), text);
  assert.ok(!prompt.includes('4319'));
  assert.throws(() => uniformPromptV3({ id: 'opaque', question: '?', facts: { values: ['gold'] } }, 'p', 'lexical'));
});
test('unchanged generic evaluationTrace unwraps real MessageContext result', () => {
  const result = { sessionId: 'session', view: { revision: 1, generationId: 'generation' }, anchor: { messageId: 'm', messagePosition: 0, start: 0, end: 1 },
    excerpts: [{ source: { messageId: 'm', messagePosition: 0, start: 0, end: 1 }, role: 'user', text: 'x' }], previous: null, next: null };
  const events = [{ item: { ToolCall: { callId: 'c', tool: 'read_message_context', partIndex: 0, partCount: 1, argumentsJsonPart: '{}' } } },
    { item: { ToolResult: { callId: 'c', partIndex: 0, partCount: 1, resultJsonPart: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ MessageContext: { result } }) }] }) } } }];
  assert.deepEqual(evaluationTrace(events, 'opaque')[0].result, result);
});

test('versioned final answer accepts exact null archive pin without rewriting raw response', async () => {
  const { finalAnswerV3 } = await import('../agent_protocol_v3.mjs');
  const answer = { taskId: 'opaque', facts: { values: ['value'] }, abstain: false,
    citations: [{ sessionId: 'session', view: { revision: 1, generationId: null }, messageId: 'm', quote: 'value' }] };
  const event = { item: { Response: { partIndex: 0, partCount: 1, textPart: JSON.stringify(answer) } } };
  const original = structuredClone(event);
  assert.deepEqual(finalAnswerV3([event], 'opaque'), answer);
  assert.deepEqual(event, original);
  for (const generationId of [undefined, false, 1, {}]) {
    const invalid = structuredClone(answer); invalid.citations[0].view.generationId = generationId;
    assert.throws(() => finalAnswerV3([{ item: { Response: { partIndex: 0, partCount: 1, textPart: JSON.stringify(invalid) } } }], 'opaque'));
  }
  const indexed = structuredClone(answer); indexed.citations[0].view.generationId = 'generation';
  assert.deepEqual(finalAnswerV3([{ item: { Response: { partIndex: 0, partCount: 1, textPart: JSON.stringify(indexed) } } }], 'opaque'), indexed);
  assert.throws(() => finalAnswerV3([event], 'other'));
});


test('versioned final answer retains every original indexed-answer schema guard', async () => {
  const { finalAnswerV3 } = await import('../agent_protocol_v3.mjs');
  const answer = { taskId: 'opaque', facts: { values: ['value'] }, abstain: false,
    citations: [{ sessionId: 'session', view: { revision: 1, generationId: 'generation' }, messageId: 'm', quote: 'value' }] };
  const events = value => [{ item: { Response: { partIndex: 0, partCount: 1, textPart: JSON.stringify(value) } } }];
  assert.deepEqual(finalAnswerV3(events(answer), 'opaque'), finalAnswer(events(answer), 'opaque'));
  const mutations = [a => a.abstain = 'false', a => a.facts.values = [1], a => a.facts.extra = true,
    a => a.extra = true, a => a.citations[0].extra = true, a => a.citations[0].quote = 1,
    a => a.citations[0].view.revision = 0, a => a.citations[0].view.revision = true,
    a => a.citations[0].view.extra = true, a => delete a.citations[0].view.generationId,
    a => a.taskId = 'other', a => a.facts = [], a => a.citations = {}];
  for (const mutate of mutations) {
    const invalid = structuredClone(answer); mutate(invalid);
    assert.throws(() => finalAnswer(events(invalid), 'opaque'));
    assert.throws(() => finalAnswerV3(events(invalid), 'opaque'));
  }
  const incomplete = [{ item: { Response: { partIndex: 0, partCount: 2, textPart: '{' } } }];
  assert.throws(() => finalAnswerV3(incomplete, 'opaque'));
});
