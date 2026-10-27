import {Result_CollectionStatus as CollectionStatus__1_3_0} from '../v1_3_0/Result.js'
import {Result_CollectionStatus as v1_4_0_Result_CollectionStatus} from './Result.js'
import {convert__collector_status_result__from__1_3_0} from './from_1_3_0_collector-status-result.js'

export function convert__result__collection_status__from__1_3_0(from: CollectionStatus__1_3_0): v1_4_0_Result_CollectionStatus {
    return new v1_4_0_Result_CollectionStatus (
        convert__collector_status_result__from__1_3_0(from.result)
    )
}