import {Operation_Receipt as api_Operation_Receipt} from './Operation.js'
import {Operation_Receipt as Receipt__1_2_0} from './v1_2_0/Operation.js'

export function convert__operation__receipt__from__1_2_0(from: Receipt__1_2_0): api_Operation_Receipt {
    return new api_Operation_Receipt (
        from.mutationId
    )
}