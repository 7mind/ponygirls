import {Failure as api_Failure} from './Failure.js'
import {Failure as Failure__1_7_0} from './v1_7_0/Failure.js'

export function convert__failure__from__1_7_0(from: Failure__1_7_0): api_Failure {
    return new api_Failure (
        from.code,
        from.message
    )
}