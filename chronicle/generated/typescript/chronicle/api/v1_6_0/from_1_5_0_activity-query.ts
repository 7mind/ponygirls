import {ActivityQuery as ActivityQuery__1_5_0} from '../v1_5_0/ActivityQuery.js'
import {ActivityQuery as v1_6_0_ActivityQuery} from './ActivityQuery.js'
import {convert__activity_collector_sort__from__1_5_0} from './from_1_5_0_activity-collector-sort.js'
import {convert__sort_direction__from__1_5_0} from './from_1_5_0_sort-direction.js'

export function convert__activity_query__from__1_5_0(from: ActivityQuery__1_5_0): v1_6_0_ActivityQuery {
    return new v1_6_0_ActivityQuery (
        from.expression,
        convert__activity_collector_sort__from__1_5_0(from.sort),
        convert__sort_direction__from__1_5_0(from.direction),
        from.cursor,
        from.limit
    )
}