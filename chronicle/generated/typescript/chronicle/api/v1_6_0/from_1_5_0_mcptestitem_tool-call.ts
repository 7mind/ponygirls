import {McpTestItem_ToolCall as ToolCall__1_5_0} from '../v1_5_0/McpTestItem.js'
import {McpTestItem_ToolCall as v1_6_0_McpTestItem_ToolCall} from './McpTestItem.js'

export function convert__mcp_test_item__tool_call__from__1_5_0(from: ToolCall__1_5_0): v1_6_0_McpTestItem_ToolCall {
    return new v1_6_0_McpTestItem_ToolCall (
        from.callId,
        from.tool,
        from.partIndex,
        from.partCount,
        from.argumentsJsonPart
    )
}