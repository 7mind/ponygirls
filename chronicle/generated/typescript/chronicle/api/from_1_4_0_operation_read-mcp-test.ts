import {Operation_ReadMcpTest as api_Operation_ReadMcpTest} from './Operation.js'
import {Operation_ReadMcpTest as ReadMcpTest__1_4_0} from './v1_4_0/Operation.js'

export function convert__operation__read_mcp_test__from__1_4_0(from: ReadMcpTest__1_4_0): api_Operation_ReadMcpTest {
    return new api_Operation_ReadMcpTest (
        from.instanceId,
        from.runId,
        from.afterSequence,
        from.limit
    )
}