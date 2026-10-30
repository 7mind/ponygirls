import { convert__archive_query__from__1_7_0 } from '../../../../protocol/typescript/conversions.js';
import {Operation_Archive as api_Operation_Archive} from './Operation.js'
import {Operation_Archive as Archive__1_7_0} from './v1_7_0/Operation.js'

export function convert__operation__archive__from__1_7_0(from: Archive__1_7_0): api_Operation_Archive {
    return new api_Operation_Archive (
        convert__archive_query__from__1_7_0(from.query)
    )
}