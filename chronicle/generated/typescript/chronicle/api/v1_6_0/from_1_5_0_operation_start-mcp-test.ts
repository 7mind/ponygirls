import {Operation_StartMcpTest as StartMcpTest__1_5_0} from '../v1_5_0/Operation.js'
import {Operation_StartMcpTest as v1_6_0_Operation_StartMcpTest} from './Operation.js'

export function convert__operation__start_mcp_test__from__1_5_0(from: StartMcpTest__1_5_0): v1_6_0_Operation_StartMcpTest {
    return new v1_6_0_Operation_StartMcpTest (
        from.instanceId,
        from.runId,
        from.prompt
    )
}