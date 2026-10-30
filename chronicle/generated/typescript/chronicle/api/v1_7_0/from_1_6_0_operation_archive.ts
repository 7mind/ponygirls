import {Operation_Archive as Archive__1_6_0} from '../v1_6_0/Operation.js'
import {Operation_Archive as v1_7_0_Operation_Archive} from './Operation.js'
import {convert__archive_query__from__1_6_0} from './from_1_6_0_archive-query.js'

export function convert__operation__archive__from__1_6_0(from: Archive__1_6_0): v1_7_0_Operation_Archive {
    return new v1_7_0_Operation_Archive (
        convert__archive_query__from__1_6_0(from.query)
    )
}