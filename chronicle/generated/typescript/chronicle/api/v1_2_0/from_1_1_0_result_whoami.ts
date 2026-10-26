import {Result_Whoami as Whoami__1_1_0} from '../v1_1_0/Result.js'
import {Result_Whoami as v1_2_0_Result_Whoami} from './Result.js'
import {convert__user_info__from__1_1_0} from './from_1_1_0_user-info.js'

export function convert__result__whoami__from__1_1_0(from: Whoami__1_1_0): v1_2_0_Result_Whoami {
    return new v1_2_0_Result_Whoami (
        convert__user_info__from__1_1_0(from.user)
    )
}