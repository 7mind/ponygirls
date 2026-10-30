import {ListedToken as api_ListedToken} from './ListedToken.js'
import {convert__token_info__from__1_7_0} from './from_1_7_0_token-info.js'
import {convert__token_source__from__1_7_0} from './from_1_7_0_token-source.js'
import {ListedToken as ListedToken__1_7_0} from './v1_7_0/ListedToken.js'

export function convert__listed_token__from__1_7_0(from: ListedToken__1_7_0): api_ListedToken {
    return new api_ListedToken (
        convert__token_info__from__1_7_0(from.info),
        convert__token_source__from__1_7_0(from.source)
    )
}