import {Operation_CancelMcpTest as CancelMcpTest__1_5_0} from '../v1_5_0/Operation.js'
import {Operation_CancelMcpTest as v1_6_0_Operation_CancelMcpTest} from './Operation.js'

export function convert__operation__cancel_mcp_test__from__1_5_0(from: CancelMcpTest__1_5_0): v1_6_0_Operation_CancelMcpTest {
    return new v1_6_0_Operation_CancelMcpTest (
        from.instanceId,
        from.runId
    )
}