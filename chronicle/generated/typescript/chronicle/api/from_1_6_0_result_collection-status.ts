import {Result_CollectionStatus as api_Result_CollectionStatus} from './Result.js'
import {convert__collector_status_result__from__1_6_0} from './from_1_6_0_collector-status-result.js'
import {Result_CollectionStatus as CollectionStatus__1_6_0} from './v1_6_0/Result.js'

export function convert__result__collection_status__from__1_6_0(from: CollectionStatus__1_6_0): api_Result_CollectionStatus {
    return new api_Result_CollectionStatus (
        convert__collector_status_result__from__1_6_0(from.result)
    )
}