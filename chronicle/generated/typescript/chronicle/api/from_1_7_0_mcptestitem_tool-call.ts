import {McpTestItem_ToolCall as api_McpTestItem_ToolCall} from './McpTestItem.js'
import {McpTestItem_ToolCall as ToolCall__1_7_0} from './v1_7_0/McpTestItem.js'

export function convert__mcp_test_item__tool_call__from__1_7_0(from: ToolCall__1_7_0): api_McpTestItem_ToolCall {
    return new api_McpTestItem_ToolCall (
        from.callId,
        from.tool,
        from.partIndex,
        from.partCount,
        from.argumentsJsonPart
    )
}