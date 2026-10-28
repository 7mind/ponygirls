import {IndexingSettings as IndexingSettings__1_4_0} from '../v1_4_0/IndexingSettings.js'
import {IndexingSettings as v1_5_0_IndexingSettings} from './IndexingSettings.js'

export function convert__indexing_settings__from__1_4_0(from: IndexingSettings__1_4_0): v1_5_0_IndexingSettings {
    return new v1_5_0_IndexingSettings (
        from.annotationSessions,
        from.embeddingRequests,
        from.embeddingBatchSize
    )
}