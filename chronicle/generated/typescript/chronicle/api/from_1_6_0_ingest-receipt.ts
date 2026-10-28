import {IngestReceipt as api_IngestReceipt} from './IngestReceipt.js'
import {IngestReceipt as IngestReceipt__1_6_0} from './v1_6_0/IngestReceipt.js'

export function convert__ingest_receipt__from__1_6_0(from: IngestReceipt__1_6_0): api_IngestReceipt {
    return new api_IngestReceipt (
        from.requestId,
        from.sessionId,
        from.revision,
        from.jobId
    )
}