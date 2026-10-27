import {CollectorStatusResult as CollectorStatusResult__1_3_0} from '../v1_3_0/CollectorStatusResult.js'
import {CollectorStatusResult as v1_4_0_CollectorStatusResult} from './CollectorStatusResult.js'
import {convert__collector_status__from__1_3_0} from './from_1_3_0_collector-status.js'

export function convert__collector_status_result__from__1_3_0(from: CollectorStatusResult__1_3_0): v1_4_0_CollectorStatusResult {
    return new v1_4_0_CollectorStatusResult (
        Array.from(from.collectors, item => convert__collector_status__from__1_3_0(item))
    )
}