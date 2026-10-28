import {IngestReceipt as IngestReceipt__1_5_0} from '../v1_5_0/IngestReceipt.js'
import {IngestReceipt as v1_6_0_IngestReceipt} from './IngestReceipt.js'

export function convert__ingest_receipt__from__1_5_0(from: IngestReceipt__1_5_0): v1_6_0_IngestReceipt {
    return new v1_6_0_IngestReceipt (
        from.requestId,
        from.sessionId,
        from.revision,
        from.jobId
    )
}