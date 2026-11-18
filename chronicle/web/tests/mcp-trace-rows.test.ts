import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpTestEvent, McpTestItem_Response, McpTestItem_ToolCall, McpTestItem_ToolResult } from '../src/api.ts';
import { traceItems, traceRows } from '../src/mcp-trace.ts';
const NOW = '2026-10-26T12:00:00Z';
function event(sequence: number, item: McpTestEvent['item']) { return new McpTestEvent(BigInt(sequence), NOW, item); }
test('trace rows pair each result with its call, keep arrival order, and show a result that arrived without its call', () => {
  const rows = traceRows(traceItems([
    event(1, new McpTestItem_ToolCall('a', 'search_sessions', 0, 1, '{"query":"x"}')),
    event(2, new McpTestItem_ToolCall('b', 'read_passage', 0, 1, '{}')),
    event(3, new McpTestItem_ToolResult('b', 0, 2, '{"part":')),
    event(4, new McpTestItem_ToolResult('a', 0, 1, '[]')),
    event(5, new McpTestItem_ToolResult('orphan', 0, 1, 'late')),
    event(6, new McpTestItem_Response(0, 1, 'final')),
  ]));
  assert.deepEqual(rows.map(row => row.kind === 'tool' ? [row.callId, row.tool, row.call?.text ?? null, row.result?.text ?? null] : [row.response.text]),
    [['a', 'search_sessions', '{"query":"x"}', '[]'], ['b', 'read_passage', '{}', null], ['orphan', null, null, 'late'], ['final']]);
});
