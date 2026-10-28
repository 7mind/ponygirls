import {Operation_StartMcpTest as api_Operation_StartMcpTest} from './Operation.js'
import {Operation_StartMcpTest as StartMcpTest__1_6_0} from './v1_6_0/Operation.js'

export function convert__operation__start_mcp_test__from__1_6_0(from: StartMcpTest__1_6_0): api_Operation_StartMcpTest {
    return new api_Operation_StartMcpTest (
        from.instanceId,
        from.runId,
        from.prompt
    )
}