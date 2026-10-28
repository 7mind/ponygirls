import {IndexingSettings as IndexingSettings__1_5_0} from '../v1_5_0/IndexingSettings.js'
import {IndexingSettings as v1_6_0_IndexingSettings} from './IndexingSettings.js'

export function convert__indexing_settings__from__1_5_0(from: IndexingSettings__1_5_0): v1_6_0_IndexingSettings {
    return new v1_6_0_IndexingSettings (
        from.annotationSessions,
        from.embeddingRequests,
        from.embeddingBatchSize
    )
}