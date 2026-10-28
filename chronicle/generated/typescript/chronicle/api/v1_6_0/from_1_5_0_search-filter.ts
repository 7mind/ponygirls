import {SearchFilter as SearchFilter__1_5_0} from '../v1_5_0/SearchFilter.js'
import {SearchFilter as v1_6_0_SearchFilter} from './SearchFilter.js'

export function convert__search_filter__from__1_5_0(from: SearchFilter__1_5_0): v1_6_0_SearchFilter {
    return new v1_6_0_SearchFilter (
        from.project,
        from.gitBranch,
        from.after,
        from.before,
        from.tags
    )
}