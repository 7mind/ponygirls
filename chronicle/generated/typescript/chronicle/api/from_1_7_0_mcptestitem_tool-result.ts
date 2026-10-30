import {McpTestItem_ToolResult as api_McpTestItem_ToolResult} from './McpTestItem.js'
import {McpTestItem_ToolResult as ToolResult__1_7_0} from './v1_7_0/McpTestItem.js'

export function convert__mcp_test_item__tool_result__from__1_7_0(from: ToolResult__1_7_0): api_McpTestItem_ToolResult {
    return new api_McpTestItem_ToolResult (
        from.callId,
        from.partIndex,
        from.partCount,
        from.resultJsonPart
    )
}