import {SourceIdentity as api_SourceIdentity} from './SourceIdentity.js'
import {convert__source_format__from__1_2_0} from './from_1_2_0_source-format.js'
import {SourceIdentity as SourceIdentity__1_2_0} from './v1_2_0/SourceIdentity.js'

export function convert__source_identity__from__1_2_0(from: SourceIdentity__1_2_0): api_SourceIdentity {
    return new api_SourceIdentity (
        from.collectorNamespace,
        from.discoveryRootId,
        convert__source_format__from__1_2_0(from.format),
        from.producerSessionId,
        from.subagentId
    )
}