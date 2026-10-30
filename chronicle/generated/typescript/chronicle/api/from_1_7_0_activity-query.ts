import {ActivityQuery as api_ActivityQuery} from './ActivityQuery.js'
import {convert__activity_collector_sort__from__1_7_0} from './from_1_7_0_activity-collector-sort.js'
import {convert__sort_direction__from__1_7_0} from './from_1_7_0_sort-direction.js'
import {ActivityQuery as ActivityQuery__1_7_0} from './v1_7_0/ActivityQuery.js'

export function convert__activity_query__from__1_7_0(from: ActivityQuery__1_7_0): api_ActivityQuery {
    return new api_ActivityQuery (
        from.expression,
        convert__activity_collector_sort__from__1_7_0(from.sort),
        convert__sort_direction__from__1_7_0(from.direction),
        from.cursor,
        from.limit
    )
}