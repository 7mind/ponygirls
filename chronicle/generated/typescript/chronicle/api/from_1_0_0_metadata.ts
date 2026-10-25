import {Metadata as api_Metadata} from './Metadata.js'
import {Metadata as Metadata__1_0_0} from './v1_0_0/Metadata.js'

export function convert__metadata__from__1_0_0(from: Metadata__1_0_0): api_Metadata {
    return new api_Metadata (
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