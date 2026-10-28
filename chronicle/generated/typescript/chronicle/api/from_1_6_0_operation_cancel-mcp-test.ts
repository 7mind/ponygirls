import {Operation_CancelMcpTest as api_Operation_CancelMcpTest} from './Operation.js'
import {Operation_CancelMcpTest as CancelMcpTest__1_6_0} from './v1_6_0/Operation.js'

export function convert__operation__cancel_mcp_test__from__1_6_0(from: CancelMcpTest__1_6_0): api_Operation_CancelMcpTest {
    return new api_Operation_CancelMcpTest (
        from.instanceId,
        from.runId
    )
}