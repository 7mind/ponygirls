import {Result as Result__1_0_0, Result_Chunks as Chunks__1_0_0, Result_Error as Error__1_0_0, Result_Facets as Facets__1_0_0, Result_Groups as Groups__1_0_0, Result_Hello as Hello__1_0_0, Result_Messages as Messages__1_0_0, Result_Mutation as Mutation__1_0_0, Result_Ping as Ping__1_0_0, Result_Pong as Pong__1_0_0, Result_Raw as Raw__1_0_0, Result_Related as Related__1_0_0, Result_Search as Search__1_0_0, Result_Session as Session__1_0_0, Result_Status as Status__1_0_0, Result_Token as Token__1_0_0, Result_Tokens as Tokens__1_0_0, Result_Whoami as Whoami__1_0_0} from '../v1_0_0/Result.js'
import {Result as v1_1_0_Result} from './Result.js'
import {convert__result__chunks__from__1_0_0} from './from_1_0_0_result_chunks.js'
import {convert__result__error__from__1_0_0} from './from_1_0_0_result_error.js'
import {convert__result__facets__from__1_0_0} from './from_1_0_0_result_facets.js'
import {convert__result__groups__from__1_0_0} from './from_1_0_0_result_groups.js'
import {convert__result__hello__from__1_0_0} from './from_1_0_0_result_hello.js'
import {convert__result__messages__from__1_0_0} from './from_1_0_0_result_messages.js'
import {convert__result__mutation__from__1_0_0} from './from_1_0_0_result_mutation.js'
import {convert__result__ping__from__1_0_0} from './from_1_0_0_result_ping.js'
import {convert__result__pong__from__1_0_0} from './from_1_0_0_result_pong.js'
import {convert__result__raw__from__1_0_0} from './from_1_0_0_result_raw.js'
import {convert__result__related__from__1_0_0} from './from_1_0_0_result_related.js'
import {convert__result__search__from__1_0_0} from './from_1_0_0_result_search.js'
import {convert__result__session__from__1_0_0} from './from_1_0_0_result_session.js'
import {convert__result__status__from__1_0_0} from './from_1_0_0_result_status.js'
import {convert__result__token__from__1_0_0} from './from_1_0_0_result_token.js'
import {convert__result__tokens__from__1_0_0} from './from_1_0_0_result_tokens.js'
import {convert__result__whoami__from__1_0_0} from './from_1_0_0_result_whoami.js'

export function convert__result__from__1_0_0(from: Result__1_0_0): v1_1_0_Result {
    if (from instanceof Hello__1_0_0) {
        return convert__result__hello__from__1_0_0(from)
    }
    if (from instanceof Pong__1_0_0) {
        return convert__result__pong__from__1_0_0(from)
    }
    if (from instanceof Whoami__1_0_0) {
        return convert__result__whoami__from__1_0_0(from)
    }
    if (from instanceof Search__1_0_0) {
        return convert__result__search__from__1_0_0(from)
    }
    if (from instanceof Session__1_0_0) {
        return convert__result__session__from__1_0_0(from)
    }
    if (from instanceof Chunks__1_0_0) {
        return convert__result__chunks__from__1_0_0(from)
    }
    if (from instanceof Messages__1_0_0) {
        return convert__result__messages__from__1_0_0(from)
    }
    if (from instanceof Raw__1_0_0) {
        return convert__result__raw__from__1_0_0(from)
    }
    if (from instanceof Related__1_0_0) {
        return convert__result__related__from__1_0_0(from)
    }
    if (from instanceof Facets__1_0_0) {
        return convert__result__facets__from__1_0_0(from)
    }
    if (from instanceof Status__1_0_0) {
        return convert__result__status__from__1_0_0(from)
    }
    if (from instanceof Tokens__1_0_0) {
        return convert__result__tokens__from__1_0_0(from)
    }
    if (from instanceof Token__1_0_0) {
        return convert__result__token__from__1_0_0(from)
    }
    if (from instanceof Groups__1_0_0) {
        return convert__result__groups__from__1_0_0(from)
    }
    if (from instanceof Mutation__1_0_0) {
        return convert__result__mutation__from__1_0_0(from)
    }
    if (from instanceof Error__1_0_0) {
        return convert__result__error__from__1_0_0(from)
    }
    if (from instanceof Ping__1_0_0) {
        return convert__result__ping__from__1_0_0(from)
    }

    throw new Error("Unknown ADT branch: " + from);
}