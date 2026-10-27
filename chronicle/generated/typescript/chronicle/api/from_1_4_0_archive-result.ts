import {ArchiveResult as api_ArchiveResult} from './ArchiveResult.js'
import {convert__archive_row__from__1_4_0} from './from_1_4_0_archive-row.js'
import {convert__archive_text_scope__from__1_4_0} from './from_1_4_0_archive-text-scope.js'
import {ArchiveResult as ArchiveResult__1_4_0} from './v1_4_0/ArchiveResult.js'

export function convert__archive_result__from__1_4_0(from: ArchiveResult__1_4_0): api_ArchiveResult {
    return new api_ArchiveResult (
        Array.from(from.rows, item => convert__archive_row__from__1_4_0(item)),
        from.total,
        from.nextCursor,
        convert__archive_text_scope__from__1_4_0(from.textScope),
        from.annChunkLimitPerOperand
    )
}