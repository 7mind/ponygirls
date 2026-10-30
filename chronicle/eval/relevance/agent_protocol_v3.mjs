import assert from 'node:assert/strict';
import { assembled, uniformPrompt, verifyAgentCatalog } from './live_protocol.mjs';

export const PROTOCOL_V3 = 'evidence-navigation-v3';
export const MAX_OUTPUT_TOKENS_V3 = 65536;
export const EXPECTED_LIMITS_V3 = Object.freeze({
  maximumRounds: 128,
  maximumToolCalls: 127,
  maximumPromptBytes: 16384,
  maximumSourceBytes: 65536,
  maximumResultBytes: 131072,
  maximumRequestBytes: 524288,
  maximumTraceBytes: 1048576,
  maximumEvents: 256,
  pageBytes: 49152,
  deadlineSeconds: 900,
  retentionSeconds: 600,
});
const BASELINE = Object.freeze(['get_chunks', 'get_messages', 'get_session', 'ingest_status', 'list_facets',
  'related_sessions', 'search_sessions', 'search_tags', 'whoami']);
const CONTEXT = Object.freeze([...BASELINE, 'read_message_context'].sort());

export function expectedToolsV3(variant) {
  assert.ok(['baseline', 'context'].includes(variant), 'explicit baseline/context catalog variant required');
  return variant === 'baseline' ? BASELINE : CONTEXT;
}

export function verifyCatalogV3(catalog, input, variant) {
  verifyAgentCatalog(catalog, input);
  assert.equal(input.agentReasoningPolicy, 'max');
  assert.equal(input.agentMaximumOutputTokens, MAX_OUTPUT_TOKENS_V3);
  assert.equal(catalog.model, input.agentModel);
  assert.deepEqual(catalog.tools.map(tool => tool.name).sort(), expectedToolsV3(variant));
  assert.deepEqual(catalog.limits, EXPECTED_LIMITS_V3, 'exact comparison limits required');
}

export function uniformPromptV3(task, project, mode) {
  assert.deepEqual(Object.keys(task).sort(), ['id', 'question'], 'only opaque id/question may enter agent task');
  assert.ok(typeof task.id === 'string' && task.id.length > 0 && typeof task.question === 'string');
  assert.ok(typeof project === 'string' && project.length > 0);
  const original = uniformPrompt(task, project, mode);
  return original.replace(
    'Retrieve original get_messages content for citations, using the exact ContentView revision and generationId returned by search. Page messages when needed; the initial page is not necessarily the full session.',
    'Use literal source text from search/chunk results or original source reads for citations, under the exact ContentView revision and generationId returned by search. Summary and tag annotations are not verbatim source evidence. For chunks with multiple source spans, read the original source rather than guessing a text-to-span mapping. Page messages when needed; the initial page is not necessarily the full session. If read_message_context is available, copy the existing hit.session.id, hit.session.view and one chunk span into its sessionId, view and anchor arguments; supply beforeBytes and afterBytes explicitly (0 or 4..2048). Its bounded excerpts retain separate message identities and UTF-8 byte ranges. Follow previous/next boundary anchors with the same exact pin and the other direction set to 0; never join disjoint excerpts into a quotation.'
  ).replace('Once original source messages explicitly support the requested facts, answer;',
    'Once literal source evidence explicitly supports the requested facts, answer;')
    .replace('Quote a verbatim substring of an original message actually retrieved.',
      'Quote a verbatim substring inside one source slice actually retrieved, retaining its exact session, view and message identity.');
}

export function finalAnswerV3(events, expectedId) {
  const response = assembled(events).find(item => item.kind === 'Response');
  assert.ok(response && response.text !== null, 'no complete final response');
  const answer = JSON.parse(response.text);
  assert.equal(answer.taskId, expectedId, 'final task identity mismatch');
  assert.deepEqual(Object.keys(answer).sort(), ['abstain', 'citations', 'facts', 'taskId']);
  assert.ok(answer.facts !== null && typeof answer.facts === 'object' && !Array.isArray(answer.facts));
  assert.deepEqual(Object.keys(answer.facts), ['values']);
  assert.ok(Array.isArray(answer.facts.values) && answer.facts.values.every(value => typeof value === 'string'));
  assert.equal(typeof answer.abstain, 'boolean'); assert.ok(Array.isArray(answer.citations));
  for (const citation of answer.citations) {
    assert.deepEqual(Object.keys(citation).sort(), ['messageId', 'quote', 'sessionId', 'view']);
    for (const key of ['messageId', 'quote', 'sessionId']) assert.equal(typeof citation[key], 'string');
    assert.deepEqual(Object.keys(citation.view).sort(), ['generationId', 'revision']);
    assert.ok(Number.isInteger(citation.view.revision) && citation.view.revision > 0);
    assert.ok(citation.view.generationId === null || typeof citation.view.generationId === 'string');
  }
  return answer;
}
