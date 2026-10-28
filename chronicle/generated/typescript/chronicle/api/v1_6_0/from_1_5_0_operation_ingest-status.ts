import {Operation_IngestStatus as IngestStatus__1_5_0} from '../v1_5_0/Operation.js'
import {Operation_IngestStatus as v1_6_0_Operation_IngestStatus} from './Operation.js'

export function convert__operation__ingest_status__from__1_5_0(from: IngestStatus__1_5_0): v1_6_0_Operation_IngestStatus {
    return new v1_6_0_Operation_IngestStatus (
        from.offset,
        from.limit
    )
}