import {ArchiveRow as ArchiveRow__1_6_0} from '../v1_6_0/ArchiveRow.js'
import {ArchiveRow as v1_7_0_ArchiveRow} from './ArchiveRow.js'
import {convert__content_view__from__1_6_0} from './from_1_6_0_content-view.js'
import {convert__job_info__from__1_6_0} from './from_1_6_0_job-info.js'
import {convert__passage_format__from__1_6_0} from './from_1_6_0_passage-format.js'
import {convert__session_info__from__1_6_0} from './from_1_6_0_session-info.js'

export function convert__archive_row__from__1_6_0(from: ArchiveRow__1_6_0): v1_7_0_ArchiveRow {
    return new v1_7_0_ArchiveRow (
        convert__session_info__from__1_6_0(from.head),
        (from.publishedView === undefined ? undefined : convert__content_view__from__1_6_0(from.publishedView)),
        (from.matchedView === undefined ? undefined : convert__content_view__from__1_6_0(from.matchedView)),
        from.lastTimestamp,
        from.messageCount,
        from.tags,
        (from.headJob === undefined ? undefined : convert__job_info__from__1_6_0(from.headJob)),
        (from.publishedFormat === undefined ? undefined : convert__passage_format__from__1_6_0(from.publishedFormat))
    )
}