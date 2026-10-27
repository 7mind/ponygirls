import {Result_Whoami as Whoami__1_3_0} from '../v1_3_0/Result.js'
import {Result_Whoami as v1_4_0_Result_Whoami} from './Result.js'
import {convert__user_info__from__1_3_0} from './from_1_3_0_user-info.js'

export function convert__result__whoami__from__1_3_0(from: Whoami__1_3_0): v1_4_0_Result_Whoami {
    return new v1_4_0_Result_Whoami (
        convert__user_info__from__1_3_0(from.user)
    )
}