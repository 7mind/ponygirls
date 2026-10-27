import {IndexingSettings as api_IndexingSettings} from './IndexingSettings.js'
import {IndexingSettings as IndexingSettings__1_4_0} from './v1_4_0/IndexingSettings.js'

export function convert__indexing_settings__from__1_4_0(from: IndexingSettings__1_4_0): api_IndexingSettings {
    return new api_IndexingSettings (
        from.annotationSessions,
        from.embeddingRequests,
        from.embeddingBatchSize
    )
}