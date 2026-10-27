import {ArchiveRow as ArchiveRow__1_3_0} from '../v1_3_0/ArchiveRow.js'
import {ArchiveRow as v1_4_0_ArchiveRow} from './ArchiveRow.js'
import {convert__content_view__from__1_3_0} from './from_1_3_0_content-view.js'
import {convert__job_info__from__1_3_0} from './from_1_3_0_job-info.js'
import {convert__session_info__from__1_3_0} from './from_1_3_0_session-info.js'

export function convert__archive_row__from__1_3_0(from: ArchiveRow__1_3_0): v1_4_0_ArchiveRow {
    return new v1_4_0_ArchiveRow (
        convert__session_info__from__1_3_0(from.head),
        (from.publishedView === undefined ? undefined : convert__content_view__from__1_3_0(from.publishedView)),
        (from.matchedView === undefined ? undefined : convert__content_view__from__1_3_0(from.matchedView)),
        from.lastTimestamp,
        from.messageCount,
        from.tags,
        (from.headJob === undefined ? undefined : convert__job_info__from__1_3_0(from.headJob))
    )
}