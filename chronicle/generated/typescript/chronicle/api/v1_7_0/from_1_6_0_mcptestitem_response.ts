import {McpTestItem_Response as Response__1_6_0} from '../v1_6_0/McpTestItem.js'
import {McpTestItem_Response as v1_7_0_McpTestItem_Response} from './McpTestItem.js'

export function convert__mcp_test_item__response__from__1_6_0(from: Response__1_6_0): v1_7_0_McpTestItem_Response {
    return new v1_7_0_McpTestItem_Response (
        from.partIndex,
        from.partCount,
        from.textPart
    )
}