import {McpTestEvent as McpTestEvent__1_4_0} from '../v1_4_0/McpTestEvent.js'
import {McpTestEvent as v1_5_0_McpTestEvent} from './McpTestEvent.js'
import {convert__mcp_test_item__from__1_4_0} from './from_1_4_0_mcp-test-item.js'

export function convert__mcp_test_event__from__1_4_0(from: McpTestEvent__1_4_0): v1_5_0_McpTestEvent {
    return new v1_5_0_McpTestEvent (
        from.sequence,
        from.observedAt,
        convert__mcp_test_item__from__1_4_0(from.item)
    )
}