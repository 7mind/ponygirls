import {McpToolDefinition as McpToolDefinition__1_4_0} from '../v1_4_0/McpToolDefinition.js'
import {McpToolDefinition as v1_5_0_McpToolDefinition} from './McpToolDefinition.js'

export function convert__mcp_tool_definition__from__1_4_0(from: McpToolDefinition__1_4_0): v1_5_0_McpToolDefinition {
    return new v1_5_0_McpToolDefinition (
        from.name,
        from.description,
        from.inputSchemaJson
    )
}