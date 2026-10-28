import {SourceIdentity as SourceIdentity__1_4_0} from '../v1_4_0/SourceIdentity.js'
import {SourceIdentity as v1_5_0_SourceIdentity} from './SourceIdentity.js'
import {convert__source_format__from__1_4_0} from './from_1_4_0_source-format.js'

export function convert__source_identity__from__1_4_0(from: SourceIdentity__1_4_0): v1_5_0_SourceIdentity {
    return new v1_5_0_SourceIdentity (
        from.collectorNamespace,
        from.discoveryRootId,
        convert__source_format__from__1_4_0(from.format),
        from.producerSessionId,
        from.subagentId
    )
}