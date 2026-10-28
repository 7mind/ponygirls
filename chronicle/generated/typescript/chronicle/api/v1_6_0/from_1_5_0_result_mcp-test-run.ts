import {Result_McpTestRun as McpTestRun__1_5_0} from '../v1_5_0/Result.js'
import {Result_McpTestRun as v1_6_0_Result_McpTestRun} from './Result.js'
import {convert__mcp_test_snapshot__from__1_5_0} from './from_1_5_0_mcp-test-snapshot.js'

export function convert__result__mcp_test_run__from__1_5_0(from: McpTestRun__1_5_0): v1_6_0_Result_McpTestRun {
    return new v1_6_0_Result_McpTestRun (
        convert__mcp_test_snapshot__from__1_5_0(from.result)
    )
}