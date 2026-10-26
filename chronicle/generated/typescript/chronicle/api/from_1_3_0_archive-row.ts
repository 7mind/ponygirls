import {ArchiveRow as api_ArchiveRow} from './ArchiveRow.js'
import {convert__content_view__from__1_3_0} from './from_1_3_0_content-view.js'
import {convert__job_info__from__1_3_0} from './from_1_3_0_job-info.js'
import {convert__session_info__from__1_3_0} from './from_1_3_0_session-info.js'
import {ArchiveRow as ArchiveRow__1_3_0} from './v1_3_0/ArchiveRow.js'

export function convert__archive_row__from__1_3_0(from: ArchiveRow__1_3_0): api_ArchiveRow {
    return new api_ArchiveRow (
        convert__session_info__from__1_3_0(from.head),
        (from.publishedView === undefined ? undefined : convert__content_view__from__1_3_0(from.publishedView)),
        (from.matchedView === undefined ? undefined : convert__content_view__from__1_3_0(from.matchedView)),
        from.lastTimestamp,
        from.messageCount,
        from.tags,
        (from.headJob === undefined ? undefined : convert__job_info__from__1_3_0(from.headJob))
    )
}