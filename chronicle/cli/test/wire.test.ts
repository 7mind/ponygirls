import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CliError } from '../src/errors.js';
import type { JsonObject } from '../src/json.js';
import { decodeOperation, decodeWire, sameUuid, validateResponse } from '../src/wire.js';

const REQUEST_ID = '0193e8d5-6f5c-7a1b-8c2d-000000000077';
const OTHER_ID = '0193e8d5-6f5c-7a1b-8c2d-000000000078';
const SESSION = 'abcdef12-abcd-4abc-8def-123456789abc';
const GENERATION = 'ba987654-fedc-4abc-8def-123456789abc';
const DIFFERENT = 'cdef1234-fedc-4abc-8def-123456789abc';
const RETRY_COUNTS = { eligibleCurrentFailed: '1', supersededRevisionFailed: '0', obsoleteProfileFailed: '0', supersededRevisionAndProfileFailed: '0', unchangedQueued: '0', unchangedRunning: '0', unchangedComplete: '0' };
const NO_GENERATION_VIEW = { revision: 4, generationId: null };
function session(generationId: string | null): JsonObject {
  return { id: SESSION, view: { revision: 4, generationId }, ownerId: 'alice', revision: 4, indexedRevision: 4, metadata: { title: 'UUID fixture', project: null, workdir: null, gitRemote: null, gitBranch: null, gitCommit: null, producer: 'pi', model: null, startedAt: null, endedAt: null, tags: [] }, source: { collectorNamespace: 'NamespaceCase', discoveryRootId: 'RootCase', format: 'Pi', producerSessionId: 'ProducerCase', subagentId: null }, completion: 'Quiescent', redacted: false };
}
function messages(generationId: string | null): JsonObject { return { Messages: { result: { messages: [], total: 0, offset: 0, view: { revision: 4, generationId } } } }; }
function getMessages(generationId: string | null, sessionId: string): JsonObject { return { GetMessages: { sessionId, offset: 0, limit: 20, view: { revision: 4, generationId } } }; }
const getSession = (sessionId: string): JsonObject => ({ GetSession: { sessionId, view: NO_GENERATION_VIEW } });
const retryFailed = (targetProfile: string): JsonObject => ({ RetryFailed: { result: { requestId: REQUEST_ID, targetProfile, retried: '1', counts: RETRY_COUNTS } } });

function check(request: JsonObject, response: JsonObject): void { validateResponse(decodeOperation(request), decodeWire('Result', response), REQUEST_ID); }
function assertProtocolError(request: JsonObject, response: JsonObject): void {
  assert.throws(() => check(request, response), (error: unknown) => error instanceof CliError && error.code === 'protocol-error');
}

const ACCEPTED: readonly { name: string; request: JsonObject; response: JsonObject }[] = [
  { name: 'session UUID in another case', request: getSession(SESSION.toUpperCase()), response: { Session: { result: { session: session(null), chunks: [] } } } },
  { name: 'pinned generation UUID in another case', request: getMessages(GENERATION.toUpperCase(), SESSION.toUpperCase()), response: messages(GENERATION) },
  { name: 'nullable generation absent on both sides', request: getMessages(null, SESSION.toUpperCase()), response: messages(null) },
  { name: 'context session UUID in another case', request: { ReadMessageContext: { sessionId: SESSION.toUpperCase(), view: NO_GENERATION_VIEW, anchor: { messageId: 'MessageCase', start: 0, end: 4 }, beforeBytes: 0, afterBytes: 0 } }, response: { MessageContext: { result: { sessionId: SESSION, view: NO_GENERATION_VIEW, anchor: { messageId: 'MessageCase', messagePosition: 0, start: 0, end: 4 }, excerpts: [{ source: { messageId: 'MessageCase', messagePosition: 0, start: 0, end: 4 }, role: 'user', text: 'case' }], previous: null, next: null } } } },
  { name: 'receipt entity UUID in another case', request: { RevokeToken: { tokenId: OTHER_ID.toUpperCase() } }, response: { Mutation: { receipt: { requestId: REQUEST_ID, operation: 'RevokeToken', entityId: OTHER_ID } } } },
];
const REJECTED: readonly { name: string; request: JsonObject; response: JsonObject }[] = [
  { name: 'genuinely different session UUID', request: getSession(DIFFERENT), response: { Session: { result: { session: session(null), chunks: [] } } } },
  { name: 'genuinely different generation UUID', request: getMessages(GENERATION.toUpperCase(), SESSION), response: messages(DIFFERENT) },
  { name: 'null generation answered with a UUID', request: getMessages(null, SESSION), response: messages(GENERATION) },
  { name: 'UUID generation answered with null', request: getMessages(GENERATION, SESSION), response: messages(null) },
  { name: 'target profile compared case-sensitively', request: { ApplyRetryFailed: { targetProfile: 'a'.repeat(64), selectionHash: 'b'.repeat(64), confirm: true } }, response: retryFailed('A'.repeat(64)) },
];

test('sameUuid compares strings case-insensitively and never equates non-strings', () => {
  assert.equal(sameUuid(SESSION.toUpperCase(), SESSION), true);
  assert.equal(sameUuid(SESSION, DIFFERENT), false);
  assert.equal(sameUuid(null, null), false);
});
for (const example of ACCEPTED) test(`validateResponse accepts ${example.name}`, () => { check(example.request, example.response); });
for (const example of REJECTED) test(`validateResponse rejects ${example.name}`, () => { assertProtocolError(example.request, example.response); });
