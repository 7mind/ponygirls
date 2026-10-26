import {Failure as Failure__1_0_0} from '../v1_0_0/Failure.js'
import {Failure as v1_1_0_Failure} from './Failure.js'

export function convert__failure__from__1_0_0(from: Failure__1_0_0): v1_1_0_Failure {
    return new v1_1_0_Failure (
        from.code,
        from.message
    )
}