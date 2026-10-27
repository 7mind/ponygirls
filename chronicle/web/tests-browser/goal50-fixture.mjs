import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { ChronicleFixture, api } from './fixture.mjs';
export const NOW = '2026-10-26T12:00:00Z', INSTANCE = '00000000-0000-4000-8000-000000060000';
export class Goal50Fixture extends ChronicleFixture {
  signals = new EventEmitter(); hintPending = []; holdHints = false; hintResult = query => new api.ExpressionHintsResult('synthetic-server-hash', NOW, 0, query.expression.length, [new api.ExpressionHint(api.ExpressionHintKind.Field, 'project:', 'project:', 8)], false);
  holdUsage = false; usagePending = []; usageDenied = false; reindexDrop = false; reindexConflict = false; reindexMalformed = false;
  passageMode = 'legacy'; passageDenied = false;
  get publishedFormat() { return this.passageMode === 'legacy' ? api.PassageFormat.LegacyAnnotations : this.passageMode === 'unverified' ? undefined : api.PassageFormat.ContiguousProblems; }
  tools = ['source_catalog', 'dynamic_tool_from_registry', 'authorized_read']; incarnation = INSTANCE; mcpRuns = new Map(); mcpDropStart = false; mcpReadFailure = null; mcpAuthorityLost = false; mcpHoldReads = false; mcpCaptureReads = false; mcpPending = []; cancelComplete = false; mcpWrongTerminal = false; cancelAuthorityLost = false; catalogDenied = false; holdCatalogs = false; catalogPending = []; holdCancels = false; cancelPending = [];
  constructor() { super(); this.goal50Operation = (operation, envelope, send, entry) => { this.signals.emit('request', operation); return this.handle(operation, envelope, send, entry); }; }
  waitCall(Type, count) {
    if (this.calls.filter(call => call.operation instanceof Type).length >= count) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.signals.off('request', check); reject(new Error(`Expected ${Type.name} call ${count}`)); }, 10_000);
      const check = () => { if (this.calls.filter(call => call.operation instanceof Type).length >= count) { clearTimeout(timer); this.signals.off('request', check); resolve(); } };
      this.signals.on('request', check);
    });
  }
  usage() {
    const unknown = new api.TokenRateWindow(9007199254740993n, 2n, 1n, undefined, 9007199254740994n), zero = new api.TokenRateWindow(0n, 0n, 0n, 0, undefined), reasoning = new api.TokenRateWindow(3n, 1n, 0n, 0.3, 4n);
    return new api.ModelUsageResult(NOW, '2026-10-26T11:00:00Z', '2026-10-26T11:59:50.010Z', NOW, 9990, api.ModelRateBasis.ProviderReportedCompletedCalls, new api.IndexingSettings(2, 3, 8), Object.values(api.ModelPurpose).map(purpose => new api.ModelUsageSlice(purpose, 1, 4n, 1n, 0n, 1n, unknown, purpose.includes('Embedding') ? undefined : purpose === api.ModelPurpose.Annotation ? new api.TokenRateWindow(10n, 1n, 0n, 1, 4n) : zero, purpose.includes('Embedding') ? undefined : purpose === api.ModelPurpose.Annotation ? reasoning : zero)));
  }
  reindexPlan() { const heads = BigInt(this.authorizedRows.filter(row => row.head.ownerId === this.user.id).length), already = 0n, target = 'contiguous-problems-profile', hash = createHash('sha256').update(JSON.stringify([this.user.id, this.targetProfile, target, heads.toString(), this.reindexConflict])).digest('hex'); return new api.OwnerReindexPlan(this.targetProfile, target, hash, heads, already, heads - already); }
  passages(view) {
    if (this.passageMode === 'long') return [new api.PassageInfo('00000000-0000-4000-8000-000000070000', 0, 'Long problem across messages', ['logical'], new api.PassagePoint('m1', 0, 0), new api.PassagePoint('m85', 84, 9), 765n, 85n, 90n)];
    const end = Buffer.byteLength(this.messagesAt(view.revision)[0].text);
    return [0, 1, 2].map((index) => { const bounds = [[0, 29], [29, 36], [36, end]][index]; return new api.PassageInfo(`00000000-0000-4000-8000-${String(70000 + index).padStart(12, '0')}`, index, index === 1 ? 'B problem' : 'A problem', ['logical'], new api.PassagePoint('m1', 0, bounds[0]), new api.PassagePoint('m1', 0, bounds[1]), BigInt(bounds[1] - bounds[0]), 1n, 1n); });
  }
  catalog() { return new api.McpTestCatalog(this.incarnation, 'declared-model', 'declared-revision', 65536, 'MAX', new api.McpTestLimits(4, 8, 16384, 65536, 131072, 524288, 1048576, 256, 49152, 900, 600), this.tools.map(name => new api.McpToolDefinition(name, `Synthetic actual tool ${name}`, '{"type":"object","properties":{}}'))); }
  trace() { const events = [new api.McpTestEvent(1n, NOW, new api.McpTestItem_ToolCall('call', this.tools[1], 0, 1, '{"query":"fresh 猫🦄"}'))]; for (let index = 0; index < 41; index++) events.push(new api.McpTestEvent(BigInt(index + 2), NOW, new api.McpTestItem_ToolResult('call', index, 41, index === 0 ? '{"source":"' : index === 40 ? 'END"}' : `part${index}🦄`))); events.push(new api.McpTestEvent(43n, NOW, new api.McpTestItem_Response(0, 2, '<script>literal-not-executed</script>猫'))); events.push(new api.McpTestEvent(44n, NOW, new api.McpTestItem_Response(1, 2, '🦄 final response'))); return events; }
  readResult(operation) {
    const run = this.mcpRuns.get(operation.runId);
    if (this.mcpAuthorityLost) return new api.Result_Error(new api.Failure('forbidden', 'MCP source authorization lost'));
    if (this.mcpReadFailure !== null) return new api.Result_Error(new api.Failure(this.mcpReadFailure, 'Registry changed; original execution is unknown'));
    if (run === undefined || run.owner !== this.user.id || operation.instanceId !== run.instanceId) return new api.Result_Error(new api.Failure('mcp-run-not-found', 'Unknown original run'));
    if (this.mcpWrongTerminal) return new api.Result_McpTestRun(new api.McpTestSnapshot(INSTANCE, INSTANCE, api.McpTestState.Expired, NOW, [], BigInt(run.events.length), false, undefined));
    const rest = run.events.filter(event => event.sequence > operation.afterSequence), events = rest.slice(0, operation.limit);
    return new api.Result_McpTestRun(new api.McpTestSnapshot(run.instanceId, run.runId, run.state, NOW, events, BigInt(run.events.length), rest.length > events.length, undefined));
  }
  handle(operation, envelope, send) {
    if (operation instanceof api.Operation_ExpressionHints) { const reply = () => send(new api.Result_ExpressionHints(this.hintResult(operation.query))); if (this.holdHints) this.hintPending.push(reply); else reply(); return true; }
    if (operation instanceof api.Operation_ModelUsage) { const reply = () => send(this.usageDenied ? new api.Result_Error(new api.Failure('forbidden', 'Usage authority removed')) : new api.Result_ModelUsage(this.usage())); if (this.holdUsage) this.usagePending.push(reply); else reply(); return true; }
    if (operation instanceof api.Operation_PreviewOwnerReindex) { send(new api.Result_OwnerReindexPreview(this.reindexPlan())); return true; }
    if (operation instanceof api.Operation_ApplyOwnerReindex) {
      const plan = this.reindexPlan(), conflict = operation.selectionHash !== plan.selectionHash;
      const result = conflict ? new api.Result_Error(new api.Failure('conflict', 'owner reindex selection changed; preview again')) : new api.Result_OwnerReindexed(new api.OwnerReindexResult(this.reindexMalformed ? INSTANCE : envelope.requestId, plan.targetProfile, plan.heads, plan.replacements, plan.alreadyCurrent, 2n));
      this.receipts.set(envelope.requestId, result); if (!this.reindexDrop) send(result); return true;
    }
    if (operation instanceof api.Operation_Receipt) { const result = this.receipts.get(operation.mutationId); if (result instanceof api.Result_OwnerReindexed || result instanceof api.Result_Error) { send(result); return true; } }
    if (operation instanceof api.Operation_GetPassages && this.passageMode !== 'legacy') {
      if (this.passageDenied || this.passageMode === 'unverified') { send(new api.Result_Error(new api.Failure(this.passageDenied ? 'forbidden' : 'unsupported-profile', 'Logical passage metadata unavailable for this profile'))); return true; }
      const all = operation.view.generationId === undefined ? [] : this.passages(operation.view); send(new api.Result_Passages(new api.PassagesResult(operation.view, operation.view.generationId === undefined ? api.PassageFormat.Unindexed : api.PassageFormat.ContiguousProblems, all.slice(operation.offset, operation.offset + operation.limit), BigInt(all.length), operation.offset))); return true;
    }
    if (operation instanceof api.Operation_GetPassageSpans) {
      const spans = this.passageMode === 'long' ? Array.from({ length: 85 }, (_, index) => new api.PassageSourceSpan(`m${index + 1}`, index, 0, 9)) : this.passages(operation.view).filter(item => item.id === operation.passageId).map(item => new api.PassageSourceSpan(item.start.messageId, item.start.messagePosition, item.start.byteOffset, item.end.byteOffset));
      send(new api.Result_PassageSpans(new api.PassageSpansResult(operation.view, operation.passageId, spans.slice(operation.offset, operation.offset + operation.limit), BigInt(spans.length), operation.offset))); return true;
    }
    if (operation instanceof api.Operation_McpTestTools) { if (this.holdCatalogs) { this.catalogPending.push({ send, catalog: this.catalog() }); return true; } send(this.catalogDenied ? new api.Result_Error(new api.Failure('forbidden', 'MCP tool catalog authority removed')) : new api.Result_McpTestTools(this.catalog())); return true; }
    if (operation instanceof api.Operation_StartMcpTest) {
      const run = { owner: this.user.id, instanceId: operation.instanceId, runId: operation.runId, state: api.McpTestState.Complete, events: this.trace(), prompt: operation.prompt };
      this.mcpRuns.set(operation.runId, run); if (!this.mcpDropStart) send(new api.Result_McpTestRun(new api.McpTestSnapshot(run.instanceId, run.runId, api.McpTestState.Queued, NOW, [], 0n, false, undefined))); return true;
    }
    if (operation instanceof api.Operation_ReadMcpTest) {
      const reply = () => send(this.readResult(operation));
      if (this.mcpHoldReads && this.mcpCaptureReads) { const captured = this.readResult(operation); this.mcpPending.push(() => send(captured)); }
      else if (this.mcpHoldReads) this.mcpPending.push(reply); else reply(); return true;
    }
    if (operation instanceof api.Operation_CancelMcpTest) { if (this.holdCancels) { this.cancelPending.push(send); return true; } const run = this.mcpRuns.get(operation.runId); if (run === undefined) send(new api.Result_Error(new api.Failure('mcp-run-not-found', 'Unknown original run'))); else { run.state = this.cancelAuthorityLost ? api.McpTestState.AuthorizationLost : this.cancelComplete ? api.McpTestState.Complete : api.McpTestState.Cancelled; send(new api.Result_McpTestRun(new api.McpTestSnapshot(run.instanceId, run.runId, run.state, NOW, [], BigInt(run.events.length), false, undefined))); } return true; }
    return false;
  }
}
export { api };
