import {Operation_GetReindexStatus as api_Operation_GetReindexStatus} from './Operation.js'
import {Operation_GetReindexStatus as GetReindexStatus__1_7_0} from './v1_7_0/Operation.js'

export function convert__operation__get_reindex_status__from__1_7_0(from: GetReindexStatus__1_7_0): api_Operation_GetReindexStatus {
    return new api_Operation_GetReindexStatus (
        from.requestId
    )
}