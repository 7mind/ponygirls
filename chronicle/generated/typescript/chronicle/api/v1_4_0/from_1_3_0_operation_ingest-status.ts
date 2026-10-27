import {Operation_IngestStatus as IngestStatus__1_3_0} from '../v1_3_0/Operation.js'
import {Operation_IngestStatus as v1_4_0_Operation_IngestStatus} from './Operation.js'

export function convert__operation__ingest_status__from__1_3_0(from: IngestStatus__1_3_0): v1_4_0_Operation_IngestStatus {
    return new v1_4_0_Operation_IngestStatus (
        from.offset,
        from.limit
    )
}