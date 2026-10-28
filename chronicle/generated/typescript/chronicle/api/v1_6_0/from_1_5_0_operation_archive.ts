import {Operation_Archive as Archive__1_5_0} from '../v1_5_0/Operation.js'
import {Operation_Archive as v1_6_0_Operation_Archive} from './Operation.js'
import {convert__archive_query__from__1_5_0} from './from_1_5_0_archive-query.js'

export function convert__operation__archive__from__1_5_0(from: Archive__1_5_0): v1_6_0_Operation_Archive {
    return new v1_6_0_Operation_Archive (
        convert__archive_query__from__1_5_0(from.query)
    )
}