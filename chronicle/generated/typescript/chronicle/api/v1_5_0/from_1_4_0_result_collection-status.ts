import {Result_CollectionStatus as CollectionStatus__1_4_0} from '../v1_4_0/Result.js'
import {Result_CollectionStatus as v1_5_0_Result_CollectionStatus} from './Result.js'
import {convert__collector_status_result__from__1_4_0} from './from_1_4_0_collector-status-result.js'

export function convert__result__collection_status__from__1_4_0(from: CollectionStatus__1_4_0): v1_5_0_Result_CollectionStatus {
    return new v1_5_0_Result_CollectionStatus (
        convert__collector_status_result__from__1_4_0(from.result)
    )
}