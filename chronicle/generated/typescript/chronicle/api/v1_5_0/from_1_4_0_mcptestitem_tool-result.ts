import {McpTestItem_ToolResult as ToolResult__1_4_0} from '../v1_4_0/McpTestItem.js'
import {McpTestItem_ToolResult as v1_5_0_McpTestItem_ToolResult} from './McpTestItem.js'

export function convert__mcp_test_item__tool_result__from__1_4_0(from: ToolResult__1_4_0): v1_5_0_McpTestItem_ToolResult {
    return new v1_5_0_McpTestItem_ToolResult (
        from.callId,
        from.partIndex,
        from.partCount,
        from.resultJsonPart
    )
}