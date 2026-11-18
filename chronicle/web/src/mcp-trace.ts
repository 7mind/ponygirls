import { BaboonCodecContext, McpTestSnapshot_JsonCodec, McpTestEvent_JsonCodec, McpTestItem_ToolCall, McpTestItem_ToolResult, McpTestItem_Response, type McpTestEvent, type McpTestSnapshot, type McpTestLimits } from './api.ts';
import { scalarUtf8Bytes } from './completion.ts';
export const MCP_EVENT_PAGE_LIMIT = 40;
export function validateMcpPage(page: McpTestSnapshot, instanceId: string, runId: string, limits: McpTestLimits): void {
  if (page.instanceId !== instanceId || page.runId !== runId) throw new Error('MCP run identity changed.');
  if (page.events.length > MCP_EVENT_PAGE_LIMIT || scalarUtf8Bytes(JSON.stringify(McpTestSnapshot_JsonCodec.instance.encode(BaboonCodecContext.Default, page))) > limits.pageBytes) throw new Error('MCP page exceeds the declared page byte/event limit.');
  for (const event of page.events) {
    const item = event.item;
    if (item instanceof McpTestItem_ToolCall) scalarUtf8Bytes(item.argumentsJsonPart);
    else if (item instanceof McpTestItem_ToolResult) scalarUtf8Bytes(item.resultJsonPart);
    else if (item instanceof McpTestItem_Response) scalarUtf8Bytes(item.textPart);
    else throw new Error('Unknown MCP trace item.');
  }
}
export type TraceKind = 'call' | 'result' | 'response';
export interface TraceItem { key: string; kind: TraceKind; callId: string | null; tool: string | null; title: string; text: string | null; received: number; total: number }
/** A tool call with its result (when one arrived), or the final response; the unit the tester renders. */
export type TraceRow =
  | { key: string; kind: 'tool'; callId: string; tool: string | null; call: TraceItem | null; result: TraceItem | null }
  | { key: string; kind: 'response'; response: TraceItem };
export function traceItems(events: readonly McpTestEvent[]): TraceItem[] {
  const items = new Map<string, { kind: TraceKind; callId: string | null; tool: string | null; title: string; parts: (string | undefined)[]; total: number }>();
  for (const event of events) {
    const item = event.item;
    const key = item instanceof McpTestItem_ToolCall ? `call:${item.callId}` : item instanceof McpTestItem_ToolResult ? `result:${item.callId}` : item instanceof McpTestItem_Response ? 'response' : null;
    if (key === null) throw new Error('Unknown MCP trace item.');
    if (!Number.isInteger(item.partCount) || item.partCount < 1 || item.partCount > 256 || !Number.isInteger(item.partIndex) || item.partIndex < 0 || item.partIndex >= item.partCount) throw new Error('Invalid multipart MCP trace.');
    const title = item instanceof McpTestItem_ToolCall ? `Tool call · ${item.tool} · ${item.callId}` : item instanceof McpTestItem_ToolResult ? `Tool result · ${item.callId}` : 'Response';
    let assembled = items.get(key);
    if (assembled === undefined) {
      const kind: TraceKind = item instanceof McpTestItem_ToolCall ? 'call' : item instanceof McpTestItem_ToolResult ? 'result' : 'response';
      assembled = { kind, callId: item instanceof McpTestItem_Response ? null : item.callId, tool: item instanceof McpTestItem_ToolCall ? item.tool : null, title, total: item.partCount, parts: Array.from({ length: item.partCount }, () => undefined) };
      items.set(key, assembled);
    }
    if (assembled.total !== item.partCount || assembled.title !== title || assembled.parts[item.partIndex] !== undefined) throw new Error('Conflicting multipart MCP trace.');
    assembled.parts[item.partIndex] = item instanceof McpTestItem_ToolCall ? item.argumentsJsonPart : item instanceof McpTestItem_ToolResult ? item.resultJsonPart : item.textPart;
  }
  return [...items].map(([key, item]) => ({ key, kind: item.kind, callId: item.callId, tool: item.tool, title: item.title, total: item.total, received: item.parts.filter(part => part !== undefined).length, text: item.parts.every(part => part !== undefined) ? item.parts.join('') : null }));
}
export function traceRows(items: readonly TraceItem[]): TraceRow[] {
  const rows: TraceRow[] = [], tools = new Map<string, Extract<TraceRow, { kind: 'tool' }>>();
  for (const item of items) {
    if (item.kind === 'response') { rows.push({ key: item.key, kind: 'response', response: item }); continue; }
    if (item.callId === null) throw new Error('A tool trace item needs a call id.');
    let row = tools.get(item.callId);
    if (row === undefined) { row = { key: `tool:${item.callId}`, kind: 'tool', callId: item.callId, tool: item.tool, call: null, result: null }; tools.set(item.callId, row); rows.push(row); }
    if (item.kind === 'call') { row.call = item; row.tool = item.tool; } else row.result = item;
  }
  return rows;
}
export function appendMcpPage(events: readonly McpTestEvent[], page: McpTestSnapshot, instanceId: string, runId: string, limits: McpTestLimits): McpTestEvent[] {
  validateMcpPage(page, instanceId, runId, limits);
  let sequence = events.at(-1)?.sequence ?? 0n;
  for (const event of page.events) { if (event.sequence !== sequence + 1n) throw new Error('MCP trace sequence gap or duplicate.'); sequence = event.sequence; }
  if (page.lastSequence < sequence || (page.hasMore && page.events.length === 0)) throw new Error('Invalid MCP page cursor.');
  const combined = [...events, ...page.events];
  if (combined.length > limits.maximumEvents || scalarUtf8Bytes(JSON.stringify(combined.map(event => McpTestEvent_JsonCodec.instance.encode(BaboonCodecContext.Default, event)))) > limits.maximumTraceBytes) throw new Error('MCP trace exceeds the declared limit; content cleared, not truncated.');
  const items = traceItems(combined);
  if (!page.hasMore && ['Complete', 'Failed', 'Cancelled'].includes(page.state) && items.some(item => item.text === null)) throw new Error('Terminal MCP trace has incomplete multipart items.');
  return combined;
}
