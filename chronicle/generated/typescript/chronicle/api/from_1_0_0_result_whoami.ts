import {Result_Whoami as api_Result_Whoami} from './Result.js'
import {convert__user_info__from__1_0_0} from './from_1_0_0_user-info.js'
import {Result_Whoami as Whoami__1_0_0} from './v1_0_0/Result.js'

export function convert__result__whoami__from__1_0_0(from: Whoami__1_0_0): api_Result_Whoami {
    return new api_Result_Whoami (
        convert__user_info__from__1_0_0(from.user)
    )
}