import {IngestRequest as api_IngestRequest} from './IngestRequest.js'
import {convert__completion__from__1_4_0} from './from_1_4_0_completion.js'
import {convert__message__from__1_4_0} from './from_1_4_0_message.js'
import {convert__metadata__from__1_4_0} from './from_1_4_0_metadata.js'
import {convert__raw_file__from__1_4_0} from './from_1_4_0_raw-file.js'
import {convert__source_identity__from__1_4_0} from './from_1_4_0_source-identity.js'
import {IngestRequest as IngestRequest__1_4_0} from './v1_4_0/IngestRequest.js'

export function convert__ingest_request__from__1_4_0(from: IngestRequest__1_4_0): api_IngestRequest {
    return new api_IngestRequest (
        from.requestId,
        convert__source_identity__from__1_4_0(from.source),
        from.expectedRevision,
        from.digest,
        convert__completion__from__1_4_0(from.completion),
        from.redacted,
        convert__metadata__from__1_4_0(from.metadata),
        Array.from(from.messages, item => convert__message__from__1_4_0(item)),
        Array.from(from.files, item => convert__raw_file__from__1_4_0(item))
    )
}