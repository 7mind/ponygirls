import {ArchiveQuery as api_ArchiveQuery} from './ArchiveQuery.js'
import {convert__archive_sort__from__1_6_0} from './from_1_6_0_archive-sort.js'
import {convert__sort_direction__from__1_6_0} from './from_1_6_0_sort-direction.js'
import {ArchiveQuery as ArchiveQuery__1_6_0} from './v1_6_0/ArchiveQuery.js'

export function convert__archive_query__from__1_6_0(from: ArchiveQuery__1_6_0): api_ArchiveQuery {
    return new api_ArchiveQuery (
        from.expression,
        convert__archive_sort__from__1_6_0(from.sort),
        convert__sort_direction__from__1_6_0(from.direction),
        from.cursor,
        from.limit
    )
}