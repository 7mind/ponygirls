import {Result_CollectionStatus as CollectionStatus__1_2_0} from '../v1_2_0/Result.js'
import {Result_CollectionStatus as v1_3_0_Result_CollectionStatus} from './Result.js'
import {convert__collector_status_result__from__1_2_0} from './from_1_2_0_collector-status-result.js'

export function convert__result__collection_status__from__1_2_0(from: CollectionStatus__1_2_0): v1_3_0_Result_CollectionStatus {
    return new v1_3_0_Result_CollectionStatus (
        convert__collector_status_result__from__1_2_0(from.result)
    )
}