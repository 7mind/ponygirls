import {McpTestItem_Response as api_McpTestItem_Response} from './McpTestItem.js'
import {McpTestItem_Response as Response__1_7_0} from './v1_7_0/McpTestItem.js'

export function convert__mcp_test_item__response__from__1_7_0(from: Response__1_7_0): api_McpTestItem_Response {
    return new api_McpTestItem_Response (
        from.partIndex,
        from.partCount,
        from.textPart
    )
}