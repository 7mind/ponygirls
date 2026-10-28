import {ArchiveResult as ArchiveResult__1_5_0} from '../v1_5_0/ArchiveResult.js'
import {ArchiveResult as v1_6_0_ArchiveResult} from './ArchiveResult.js'
import {convert__archive_row__from__1_5_0} from './from_1_5_0_archive-row.js'
import {convert__archive_text_scope__from__1_5_0} from './from_1_5_0_archive-text-scope.js'

export function convert__archive_result__from__1_5_0(from: ArchiveResult__1_5_0): v1_6_0_ArchiveResult {
    return new v1_6_0_ArchiveResult (
        Array.from(from.rows, item => convert__archive_row__from__1_5_0(item)),
        from.total,
        from.nextCursor,
        convert__archive_text_scope__from__1_5_0(from.textScope),
        from.annChunkLimitPerOperand
    )
}