import {Failure as Failure__1_2_0} from '../v1_2_0/Failure.js'
import {Failure as v1_3_0_Failure} from './Failure.js'

export function convert__failure__from__1_2_0(from: Failure__1_2_0): v1_3_0_Failure {
    return new v1_3_0_Failure (
        from.code,
        from.message
    )
}