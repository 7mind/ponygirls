import {McpTestItem_ToolResult as ToolResult__1_6_0} from '../v1_6_0/McpTestItem.js'
import {McpTestItem_ToolResult as v1_7_0_McpTestItem_ToolResult} from './McpTestItem.js'

export function convert__mcp_test_item__tool_result__from__1_6_0(from: ToolResult__1_6_0): v1_7_0_McpTestItem_ToolResult {
    return new v1_7_0_McpTestItem_ToolResult (
        from.callId,
        from.partIndex,
        from.partCount,
        from.resultJsonPart
    )
}