import {ArchiveQuery as ArchiveQuery__1_4_0} from '../v1_4_0/ArchiveQuery.js'
import {ArchiveQuery as v1_5_0_ArchiveQuery} from './ArchiveQuery.js'
import {convert__archive_sort__from__1_4_0} from './from_1_4_0_archive-sort.js'
import {convert__sort_direction__from__1_4_0} from './from_1_4_0_sort-direction.js'

export function convert__archive_query__from__1_4_0(from: ArchiveQuery__1_4_0): v1_5_0_ArchiveQuery {
    return new v1_5_0_ArchiveQuery (
        from.expression,
        convert__archive_sort__from__1_4_0(from.sort),
        convert__sort_direction__from__1_4_0(from.direction),
        from.cursor,
        from.limit
    )
}