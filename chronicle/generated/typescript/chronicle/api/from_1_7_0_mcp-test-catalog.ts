import {McpTestCatalog as api_McpTestCatalog} from './McpTestCatalog.js'
import {convert__mcp_test_limits__from__1_7_0} from './from_1_7_0_mcp-test-limits.js'
import {convert__mcp_tool_definition__from__1_7_0} from './from_1_7_0_mcp-tool-definition.js'
import {McpTestCatalog as McpTestCatalog__1_7_0} from './v1_7_0/McpTestCatalog.js'

export function convert__mcp_test_catalog__from__1_7_0(from: McpTestCatalog__1_7_0): api_McpTestCatalog {
    return new api_McpTestCatalog (
        from.instanceId,
        from.model,
        from.modelRevision,
        from.maximumOutputTokens,
        from.reasoningPolicy,
        convert__mcp_test_limits__from__1_7_0(from.limits),
        Array.from(from.tools, item => convert__mcp_tool_definition__from__1_7_0(item))
    )
}