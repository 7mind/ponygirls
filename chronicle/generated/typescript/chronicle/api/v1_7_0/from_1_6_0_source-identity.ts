import {SourceIdentity as SourceIdentity__1_6_0} from '../v1_6_0/SourceIdentity.js'
import {SourceIdentity as v1_7_0_SourceIdentity} from './SourceIdentity.js'
import {convert__source_format__from__1_6_0} from './from_1_6_0_source-format.js'

export function convert__source_identity__from__1_6_0(from: SourceIdentity__1_6_0): v1_7_0_SourceIdentity {
    return new v1_7_0_SourceIdentity (
        from.collectorNamespace,
        from.discoveryRootId,
        convert__source_format__from__1_6_0(from.format),
        from.producerSessionId,
        from.subagentId
    )
}