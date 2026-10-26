import {Operation_Archive as api_Operation_Archive} from './Operation.js'
import {convert__archive_query__from__1_3_0} from './from_1_3_0_archive-query.js'
import {Operation_Archive as Archive__1_3_0} from './v1_3_0/Operation.js'

export function convert__operation__archive__from__1_3_0(from: Archive__1_3_0): api_Operation_Archive {
    return new api_Operation_Archive (
        convert__archive_query__from__1_3_0(from.query)
    )
}