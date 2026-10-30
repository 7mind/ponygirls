import {SearchFilter as api_SearchFilter} from './SearchFilter.js'
import {SearchFilter as SearchFilter__1_7_0} from './v1_7_0/SearchFilter.js'

export function convert__search_filter__from__1_7_0(from: SearchFilter__1_7_0): api_SearchFilter {
    return new api_SearchFilter (
        from.project,
        from.gitBranch,
        from.after,
        from.before,
        from.tags
    )
}