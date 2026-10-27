import {Result_McpTestRun as api_Result_McpTestRun} from './Result.js'
import {convert__mcp_test_snapshot__from__1_4_0} from './from_1_4_0_mcp-test-snapshot.js'
import {Result_McpTestRun as McpTestRun__1_4_0} from './v1_4_0/Result.js'

export function convert__result__mcp_test_run__from__1_4_0(from: McpTestRun__1_4_0): api_Result_McpTestRun {
    return new api_Result_McpTestRun (
        convert__mcp_test_snapshot__from__1_4_0(from.result)
    )
}