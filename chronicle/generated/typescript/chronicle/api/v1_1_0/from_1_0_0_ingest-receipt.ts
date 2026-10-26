import {IngestReceipt as IngestReceipt__1_0_0} from '../v1_0_0/IngestReceipt.js'
import {IngestReceipt as v1_1_0_IngestReceipt} from './IngestReceipt.js'

export function convert__ingest_receipt__from__1_0_0(from: IngestReceipt__1_0_0): v1_1_0_IngestReceipt {
    return new v1_1_0_IngestReceipt (
        from.requestId,
        from.sessionId,
        from.revision,
        from.jobId
    )
}