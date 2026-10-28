import {Result_McpTestTools as McpTestTools__1_4_0} from '../v1_4_0/Result.js'
import {Result_McpTestTools as v1_5_0_Result_McpTestTools} from './Result.js'
import {convert__mcp_test_catalog__from__1_4_0} from './from_1_4_0_mcp-test-catalog.js'

export function convert__result__mcp_test_tools__from__1_4_0(from: McpTestTools__1_4_0): v1_5_0_Result_McpTestTools {
    return new v1_5_0_Result_McpTestTools (
        convert__mcp_test_catalog__from__1_4_0(from.result)
    )
}