import {Operation_StartMcpTest as StartMcpTest__1_4_0} from '../v1_4_0/Operation.js'
import {Operation_StartMcpTest as v1_5_0_Operation_StartMcpTest} from './Operation.js'

export function convert__operation__start_mcp_test__from__1_4_0(from: StartMcpTest__1_4_0): v1_5_0_Operation_StartMcpTest {
    return new v1_5_0_Operation_StartMcpTest (
        from.instanceId,
        from.runId,
        from.prompt
    )
}