import {McpTestLimits as McpTestLimits__1_6_0} from '../v1_6_0/McpTestLimits.js'
import {McpTestLimits as v1_7_0_McpTestLimits} from './McpTestLimits.js'

export function convert__mcp_test_limits__from__1_6_0(from: McpTestLimits__1_6_0): v1_7_0_McpTestLimits {
    return new v1_7_0_McpTestLimits (
        from.maximumRounds,
        from.maximumToolCalls,
        from.maximumPromptBytes,
        from.maximumSourceBytes,
        from.maximumResultBytes,
        from.maximumRequestBytes,
        from.maximumTraceBytes,
        from.maximumEvents,
        from.pageBytes,
        from.deadlineSeconds,
        from.retentionSeconds
    )
}