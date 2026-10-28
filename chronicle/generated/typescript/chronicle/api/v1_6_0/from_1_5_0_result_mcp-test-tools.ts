import {Result_McpTestTools as McpTestTools__1_5_0} from '../v1_5_0/Result.js'
import {Result_McpTestTools as v1_6_0_Result_McpTestTools} from './Result.js'
import {convert__mcp_test_catalog__from__1_5_0} from './from_1_5_0_mcp-test-catalog.js'

export function convert__result__mcp_test_tools__from__1_5_0(from: McpTestTools__1_5_0): v1_6_0_Result_McpTestTools {
    return new v1_6_0_Result_McpTestTools (
        convert__mcp_test_catalog__from__1_5_0(from.result)
    )
}