import {Operation_ReadMcpTest as ReadMcpTest__1_6_0} from '../v1_6_0/Operation.js'
import {Operation_ReadMcpTest as v1_7_0_Operation_ReadMcpTest} from './Operation.js'

export function convert__operation__read_mcp_test__from__1_6_0(from: ReadMcpTest__1_6_0): v1_7_0_Operation_ReadMcpTest {
    return new v1_7_0_Operation_ReadMcpTest (
        from.instanceId,
        from.runId,
        from.afterSequence,
        from.limit
    )
}