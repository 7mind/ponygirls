import {McpTestEvent as api_McpTestEvent} from './McpTestEvent.js'
import {convert__mcp_test_item__from__1_6_0} from './from_1_6_0_mcp-test-item.js'
import {McpTestEvent as McpTestEvent__1_6_0} from './v1_6_0/McpTestEvent.js'

export function convert__mcp_test_event__from__1_6_0(from: McpTestEvent__1_6_0): api_McpTestEvent {
    return new api_McpTestEvent (
        from.sequence,
        from.observedAt,
        convert__mcp_test_item__from__1_6_0(from.item)
    )
}