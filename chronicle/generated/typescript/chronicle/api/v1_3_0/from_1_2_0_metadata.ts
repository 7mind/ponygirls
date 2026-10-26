import {Metadata as Metadata__1_2_0} from '../v1_2_0/Metadata.js'
import {Metadata as v1_3_0_Metadata} from './Metadata.js'

export function convert__metadata__from__1_2_0(from: Metadata__1_2_0): v1_3_0_Metadata {
    return new v1_3_0_Metadata (
        from.title,
        from.project,
        from.workdir,
        from.gitRemote,
        from.gitBranch,
        from.gitCommit,
        from.producer,
        from.model,
        from.startedAt,
        from.endedAt,
        from.tags
    )
}