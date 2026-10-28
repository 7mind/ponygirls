import {ListedToken as ListedToken__1_4_0} from '../v1_4_0/ListedToken.js'
import {ListedToken as v1_5_0_ListedToken} from './ListedToken.js'
import {convert__token_info__from__1_4_0} from './from_1_4_0_token-info.js'
import {convert__token_source__from__1_4_0} from './from_1_4_0_token-source.js'

export function convert__listed_token__from__1_4_0(from: ListedToken__1_4_0): v1_5_0_ListedToken {
    return new v1_5_0_ListedToken (
        convert__token_info__from__1_4_0(from.info),
        convert__token_source__from__1_4_0(from.source)
    )
}