import {Operation_Receipt as Receipt__1_6_0} from '../v1_6_0/Operation.js'
import {Operation_Receipt as v1_7_0_Operation_Receipt} from './Operation.js'

export function convert__operation__receipt__from__1_6_0(from: Receipt__1_6_0): v1_7_0_Operation_Receipt {
    return new v1_7_0_Operation_Receipt (
        from.mutationId
    )
}