import {IndexingSettings as IndexingSettings__1_6_0} from '../v1_6_0/IndexingSettings.js'
import {IndexingSettings as v1_7_0_IndexingSettings} from './IndexingSettings.js'

export function convert__indexing_settings__from__1_6_0(from: IndexingSettings__1_6_0): v1_7_0_IndexingSettings {
    return new v1_7_0_IndexingSettings (
        from.annotationSessions,
        from.embeddingRequests,
        from.embeddingBatchSize
    )
}