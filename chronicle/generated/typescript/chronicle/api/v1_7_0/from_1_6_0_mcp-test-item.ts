import {McpTestItem as McpTestItem__1_6_0, McpTestItem_Response as Response__1_6_0, McpTestItem_ToolCall as ToolCall__1_6_0, McpTestItem_ToolResult as ToolResult__1_6_0} from '../v1_6_0/McpTestItem.js'
import {McpTestItem as v1_7_0_McpTestItem} from './McpTestItem.js'
import {convert__mcp_test_item__response__from__1_6_0} from './from_1_6_0_mcptestitem_response.js'
import {convert__mcp_test_item__tool_call__from__1_6_0} from './from_1_6_0_mcptestitem_tool-call.js'
import {convert__mcp_test_item__tool_result__from__1_6_0} from './from_1_6_0_mcptestitem_tool-result.js'

export function convert__mcp_test_item__from__1_6_0(from: McpTestItem__1_6_0): v1_7_0_McpTestItem {
    if (from instanceof ToolCall__1_6_0) {
        return convert__mcp_test_item__tool_call__from__1_6_0(from)
    }
    if (from instanceof ToolResult__1_6_0) {
        return convert__mcp_test_item__tool_result__from__1_6_0(from)
    }
    if (from instanceof Response__1_6_0) {
        return convert__mcp_test_item__response__from__1_6_0(from)
    }

    throw new Error("Unknown ADT branch: " + from);
}