import {McpTestSnapshot as McpTestSnapshot__1_6_0} from '../v1_6_0/McpTestSnapshot.js'
import {McpTestSnapshot as v1_7_0_McpTestSnapshot} from './McpTestSnapshot.js'
import {convert__failure__from__1_6_0} from './from_1_6_0_failure.js'
import {convert__mcp_test_event__from__1_6_0} from './from_1_6_0_mcp-test-event.js'
import {convert__mcp_test_state__from__1_6_0} from './from_1_6_0_mcp-test-state.js'

export function convert__mcp_test_snapshot__from__1_6_0(from: McpTestSnapshot__1_6_0): v1_7_0_McpTestSnapshot {
    return new v1_7_0_McpTestSnapshot (
        from.instanceId,
        from.runId,
        convert__mcp_test_state__from__1_6_0(from.state),
        from.observedAt,
        Array.from(from.events, item => convert__mcp_test_event__from__1_6_0(item)),
        from.lastSequence,
        from.hasMore,
        (from.failure === undefined ? undefined : convert__failure__from__1_6_0(from.failure))
    )
}