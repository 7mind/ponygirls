import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExpressionHint, ExpressionHintKind, ExpressionHintsResult, Operation_ApplyOwnerReindex, OwnerReindexResult, Result_OwnerReindexed, Result_Mutation, MutationReceipt, ContentView, PassageFormat, PassagePoint, PassageInfo, PassageSourceSpan, PassagesResult, PassageSpansResult, McpTestLimits, McpTestSnapshot, McpTestState, McpTestItem_ToolCall, McpTestItem_ToolResult, McpTestItem_Response, McpTestEvent, ModelPurpose, ModelRateBasis, ModelUsageSlice, ModelUsageResult, IndexingSettings, TokenRateWindow } from '../src/api.ts';
import { acceptExpressionHint, scalarBoundary, scalarUtf8Bytes } from '../src/completion.ts';
import { validateMutationResult } from '../src/mutations.ts';
import { RequestFailure } from '../src/transport/types.ts';
import { validatePassages, validatePassageSpans } from '../src/passages.ts';
import { appendMcpPage, traceItems } from '../src/mcp-trace.ts';
import { validateModelUsage } from '../src/model-usage.ts';
const ID = '00000000-0000-4000-8000-000000000001', OTHER = '00000000-0000-4000-8000-000000000002', NOW = '2026-10-26T12:00:00Z';
const limits = new McpTestLimits(4, 8, 16384, 65536, 131072, 524288, 1048576, 256, 49152, 900, 600);
function hints(start: number, end: number, text: string, caret: number) { const hint = new ExpressionHint(ExpressionHintKind.Value, text, text, caret); return { hint, result: new ExpressionHintsResult('server-query-hash', NOW, start, end, [hint], false) }; }
test('BA specified: completions replace the whole server range without changing Unicode, escapes or text outside it', () => {
  const expression = '猫🦄 AND project:"old\\:value" OR tag:"retained"', start = expression.indexOf('"old'), end = expression.indexOf(' OR');
  const { hint, result } = hints(start, end, '"new\\\\path\\\"quoted\\:x"', 5);
  const accepted = acceptExpressionHint(expression, result, hint);
  assert.equal(accepted.expression, expression.slice(0, start) + hint.insertText + expression.slice(end)); assert.equal(accepted.caret, start + 5);
  assert.equal(scalarBoundary('🦄', 1), false); assert.equal(scalarBoundary('🦄', 2), true);
});
test('BA specified: invalid surrogate boundaries and unpaired insertion scalars fail closed', () => {
  for (const [start, end, text, caret] of [[1, 2, 'x', 1], [0, 2, '🦄', 1], [0, 2, '\ud800', 1]] as const) { const { hint, result } = hints(start, end, text, caret); assert.throws(() => acceptExpressionHint('🦄 end', result, hint), /Unicode|surrogate/); }
  assert.equal(scalarUtf8Bytes('猫🦄'), 7); assert.throws(() => scalarUtf8Bytes('\udc00'), /surrogate/);
  assert.equal(scalarUtf8Bytes('🦄'.repeat(4096)), limits.maximumPromptBytes); assert.equal(scalarUtf8Bytes('🦄'.repeat(4097)), 16388);
});
test('BA specified: owner reprocess result must match original action ID, target and exact nonnegative i64 shape', () => {
  const operation = new Operation_ApplyOwnerReindex('target', 'hash', true), result = new OwnerReindexResult(ID, 'target', 9007199254740995n, 9007199254740993n, 2n, 8n), valid = new Result_OwnerReindexed(result);
  assert.equal(validateMutationResult(operation, valid, ID), valid);
  for (const invalid of [new Result_Mutation(new MutationReceipt(ID, 'ApplyOwnerReindex', undefined)), new Result_OwnerReindexed(result.with({ requestId: OTHER })), new Result_OwnerReindexed(result.with({ targetProfile: 'other' })), new Result_OwnerReindexed(result.with({ queued: -1n })), new Result_OwnerReindexed(result.with({ heads: 0n }))]) {
    assert.throws(() => validateMutationResult(operation, invalid, ID), cause => cause instanceof RequestFailure && cause.outcome === 'uncertain' && cause.receiptId === ID);
  }
});
const view = new ContentView(1, ID);
function passage() { return new PassageInfo(OTHER, 0, 'A', ['synthetic'], new PassagePoint('m1', 0, 29), new PassagePoint('m2', 1, 7), 50n, 2n, 4n); }
test('BA specified: passage pages retain exact pins and reject unverified formats, inverted extents and oversized pages', () => {
  const page = new PassagesResult(view, PassageFormat.ContiguousProblems, [passage()], 1n, 0);
  assert.equal(validatePassages(page, view, 0), page);
  for (const invalid of [page.with({ view: new ContentView(2, ID) }), page.with({ offset: 40 }), page.with({ passages: Array.from({ length: 41 }, passage), total: 41n }), page.with({ format: 'Unknown' as PassageFormat }), page.with({ passages: [passage().with({ end: new PassagePoint('m1', 0, 0) })] })]) assert.throws(() => validatePassages(invalid, view, 0));
  for (const format of [PassageFormat.LegacyAnnotations, PassageFormat.Unindexed]) assert.equal(validatePassages(new PassagesResult(view, format, [], 0n, 0), view, 0).passages.length, 0);
});
test('BA specified: bounded span pages cannot cross passage/view identity or fabricate empty ranges', () => {
  const page = new PassageSpansResult(view, OTHER, [new PassageSourceSpan('m1', 0, 29, 36)], 85n, 0);
  assert.equal(validatePassageSpans(page, view, OTHER, 0), page);
  for (const invalid of [page.with({ passageId: ID }), page.with({ spans: [new PassageSourceSpan('m1', 0, 36, 29)] }), page.with({ view: new ContentView(1, OTHER) })]) assert.throws(() => validatePassageSpans(invalid, view, OTHER, 0));
});
function event(sequence: number, item: McpTestEvent['item']) { return new McpTestEvent(BigInt(sequence), NOW, item); }
function snapshot(events: McpTestEvent[], hasMore: boolean, state: McpTestState) { return new McpTestSnapshot(ID, OTHER, state, NOW, events, 4n, hasMore, undefined); }
test('BA specified: multipart MCP items reconstruct full scalar text across pages, never page metadata as cursor', () => {
  const first = [event(1, new McpTestItem_ToolCall('call', 'actual_dynamic_tool', 0, 1, '{"q":"猫"}')), event(2, new McpTestItem_ToolResult('call', 0, 2, '{"source":"🦄'))];
  const partial = appendMcpPage([], snapshot(first, true, McpTestState.Complete), ID, OTHER, limits);
  assert.equal(partial.at(-1)!.sequence, 2n); assert.equal(traceItems(partial)[1]!.text, null);
  const full = appendMcpPage(partial, snapshot([event(3, new McpTestItem_ToolResult('call', 1, 2, '猫"}')), event(4, new McpTestItem_Response(0, 1, '<script>literal</script>'))], false, McpTestState.Complete), ID, OTHER, limits);
  assert.equal(traceItems(full)[1]!.text, '{"source":"🦄猫"}'); assert.equal(traceItems(full)[2]!.text, '<script>literal</script>');
});
test('BA specified: MCP run mismatches, sequence gaps, duplicate parts, incomplete terminals and overflow fail explicitly', () => {
  const response = event(1, new McpTestItem_Response(0, 2, 'first'));
  assert.throws(() => appendMcpPage([], snapshot([response], false, McpTestState.Complete), ID, OTHER, limits), /incomplete/);
  assert.throws(() => appendMcpPage([], snapshot([response.with({ sequence: 2n })], true, McpTestState.Running), ID, OTHER, limits), /sequence/);
  assert.throws(() => appendMcpPage([], snapshot([response], true, McpTestState.Running), OTHER, OTHER, limits), /identity/);
  assert.throws(() => appendMcpPage([], snapshot([response], true, McpTestState.Running), ID, OTHER, limits.with({ maximumTraceBytes: 1 })), /limit/);
  assert.throws(() => traceItems([response, response.with({ sequence: 2n })]), /Conflicting/);
});
function usage() {
  const rate = new TokenRateWindow(9007199254740993n, 2n, 1n, undefined, 9007199254740994n), zero = new TokenRateWindow(0n, 0n, 0n, 0, undefined);
  return new ModelUsageResult(NOW, NOW, NOW, NOW, 9990, ModelRateBasis.ProviderReportedCompletedCalls, new IndexingSettings(2, 3, 8), Object.values(ModelPurpose).map(purpose => new ModelUsageSlice(purpose, 1, 4n, 1n, 0n, 1n, rate, purpose.includes('Embedding') ? undefined : zero, purpose.includes('Embedding') ? undefined : zero)));
}
test('BA specified: completed-call usage retains bigints, unknown versus zero versus N/A and exactly four purposes', () => {
  const result = usage(); assert.equal(validateModelUsage(result), result);
  assert.equal(result.samples[0]!.input.knownTokens, 9007199254740993n); assert.equal(result.samples[0]!.input.tokensPerSecond, undefined);
  assert.equal(result.samples[0]!.output!.tokensPerSecond, 0); assert.equal(result.samples.find(sample => sample.purpose === ModelPurpose.QueryEmbedding)!.output, undefined);
  for (const invalid of [result.with({ samples: result.samples.slice(1) }), result.with({ coveredMillis: 10001 }), result.with({ samples: [...result.samples.slice(0, 3), result.samples[0]!] }), result.with({ samples: result.samples.map(sample => sample.with({ input: sample.input.with({ tokensPerSecond: 0 }) })) })]) assert.throws(() => validateModelUsage(invalid));
});

test('BA regression: MCP exact encoded page budgets and malformed scalar parts fail closed', () => {
  const item = event(1, new McpTestItem_Response(0, 1, 'literal'));
  assert.throws(() => appendMcpPage([], snapshot([item], false, McpTestState.Complete).with({ lastSequence: 1n }), ID, OTHER, limits.with({ pageBytes: 1 })), /page.*limit/i);
});
test('BA regression: MCP part text cannot hide unpaired scalars behind JSON escaping', () => {
  assert.throws(() => appendMcpPage([], snapshot([event(1, new McpTestItem_Response(0, 1, '\ud800'))], false, McpTestState.Complete), ID, OTHER, limits), /surrogate/);
});
test('BA specified: missing generation output is unknown/error, never mislabeled embedding N/A', () => {
  const result = usage();
  assert.throws(() => validateModelUsage(result.with({ samples: result.samples.map(sample => sample.purpose === ModelPurpose.Annotation ? sample.with({ output: undefined }) : sample) })), /applicability/);
  assert.throws(() => validateModelUsage(result.with({ samples: result.samples.map(sample => sample.purpose === ModelPurpose.DocumentEmbedding ? sample.with({ output: new TokenRateWindow(0n, 0n, 0n, 0, undefined) }) : sample) })), /applicability/);
});
