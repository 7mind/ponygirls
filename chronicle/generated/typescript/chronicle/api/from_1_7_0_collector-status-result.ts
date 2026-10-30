import {CollectorStatusResult as api_CollectorStatusResult} from './CollectorStatusResult.js'
import {convert__collector_status__from__1_7_0} from './from_1_7_0_collector-status.js'
import {CollectorStatusResult as CollectorStatusResult__1_7_0} from './v1_7_0/CollectorStatusResult.js'

export function convert__collector_status_result__from__1_7_0(from: CollectorStatusResult__1_7_0): api_CollectorStatusResult {
    return new api_CollectorStatusResult (
        Array.from(from.collectors, item => convert__collector_status__from__1_7_0(item))
    )
}