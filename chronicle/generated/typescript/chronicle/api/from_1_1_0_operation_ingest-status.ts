import {Operation_IngestStatus as api_Operation_IngestStatus} from './Operation.js'
import {Operation_IngestStatus as IngestStatus__1_1_0} from './v1_1_0/Operation.js'

export function convert__operation__ingest_status__from__1_1_0(from: IngestStatus__1_1_0): api_Operation_IngestStatus {
    return new api_Operation_IngestStatus (
        from.offset,
        from.limit
    )
}