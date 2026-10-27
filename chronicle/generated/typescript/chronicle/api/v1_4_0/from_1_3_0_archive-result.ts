import {ArchiveResult as ArchiveResult__1_3_0} from '../v1_3_0/ArchiveResult.js'
import {ArchiveResult as v1_4_0_ArchiveResult} from './ArchiveResult.js'
import {convert__archive_row__from__1_3_0} from './from_1_3_0_archive-row.js'
import {convert__archive_text_scope__from__1_3_0} from './from_1_3_0_archive-text-scope.js'

export function convert__archive_result__from__1_3_0(from: ArchiveResult__1_3_0): v1_4_0_ArchiveResult {
    return new v1_4_0_ArchiveResult (
        Array.from(from.rows, item => convert__archive_row__from__1_3_0(item)),
        from.total,
        from.nextCursor,
        convert__archive_text_scope__from__1_3_0(from.textScope),
        from.annChunkLimitPerOperand
    )
}