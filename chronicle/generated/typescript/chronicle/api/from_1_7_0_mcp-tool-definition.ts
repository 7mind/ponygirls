import {McpToolDefinition as api_McpToolDefinition} from './McpToolDefinition.js'
import {McpToolDefinition as McpToolDefinition__1_7_0} from './v1_7_0/McpToolDefinition.js'

export function convert__mcp_tool_definition__from__1_7_0(from: McpToolDefinition__1_7_0): api_McpToolDefinition {
    return new api_McpToolDefinition (
        from.name,
        from.description,
        from.inputSchemaJson
    )
}