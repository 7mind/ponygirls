import {Result as api_Result} from './Result.js'
import {convert__result__activity_jobs__from__1_6_0} from './from_1_6_0_result_activity-jobs.js'
import {convert__result__activity__from__1_6_0} from './from_1_6_0_result_activity.js'
import {convert__result__archive__from__1_6_0} from './from_1_6_0_result_archive.js'
import {convert__result__chunks__from__1_6_0} from './from_1_6_0_result_chunks.js'
import {convert__result__collection_status__from__1_6_0} from './from_1_6_0_result_collection-status.js'
import {convert__result__error__from__1_6_0} from './from_1_6_0_result_error.js'
import {convert__result__expression_hints__from__1_6_0} from './from_1_6_0_result_expression-hints.js'
import {convert__result__facets__from__1_6_0} from './from_1_6_0_result_facets.js'
import {convert__result__groups__from__1_6_0} from './from_1_6_0_result_groups.js'
import {convert__result__hello__from__1_6_0} from './from_1_6_0_result_hello.js'
import {convert__result__located_message__from__1_6_0} from './from_1_6_0_result_located-message.js'
import {convert__result__mcp_test_run__from__1_6_0} from './from_1_6_0_result_mcp-test-run.js'
import {convert__result__mcp_test_tools__from__1_6_0} from './from_1_6_0_result_mcp-test-tools.js'
import {convert__result__messages__from__1_6_0} from './from_1_6_0_result_messages.js'
import {convert__result__model_usage__from__1_6_0} from './from_1_6_0_result_model-usage.js'
import {convert__result__mutation__from__1_6_0} from './from_1_6_0_result_mutation.js'
import {convert__result__owner_reindex_preview__from__1_6_0} from './from_1_6_0_result_owner-reindex-preview.js'
import {convert__result__owner_reindexed__from__1_6_0} from './from_1_6_0_result_owner-reindexed.js'
import {convert__result__passage_spans__from__1_6_0} from './from_1_6_0_result_passage-spans.js'
import {convert__result__passages__from__1_6_0} from './from_1_6_0_result_passages.js'
import {convert__result__ping__from__1_6_0} from './from_1_6_0_result_ping.js'
import {convert__result__pong__from__1_6_0} from './from_1_6_0_result_pong.js'
import {convert__result__raw__from__1_6_0} from './from_1_6_0_result_raw.js'
import {convert__result__related__from__1_6_0} from './from_1_6_0_result_related.js'
import {convert__result__retry_failed_preview__from__1_6_0} from './from_1_6_0_result_retry-failed-preview.js'
import {convert__result__retry_failed__from__1_6_0} from './from_1_6_0_result_retry-failed.js'
import {convert__result__search__from__1_6_0} from './from_1_6_0_result_search.js'
import {convert__result__session_message_search__from__1_6_0} from './from_1_6_0_result_session-message-search.js'
import {convert__result__session__from__1_6_0} from './from_1_6_0_result_session.js'
import {convert__result__status__from__1_6_0} from './from_1_6_0_result_status.js'
import {convert__result__token__from__1_6_0} from './from_1_6_0_result_token.js'
import {convert__result__tokens__from__1_6_0} from './from_1_6_0_result_tokens.js'
import {convert__result__whoami__from__1_6_0} from './from_1_6_0_result_whoami.js'
import {Result as Result__1_6_0, Result_Activity as Activity__1_6_0, Result_ActivityJobs as ActivityJobs__1_6_0, Result_Archive as Archive__1_6_0, Result_Chunks as Chunks__1_6_0, Result_CollectionStatus as CollectionStatus__1_6_0, Result_Error as Error__1_6_0, Result_ExpressionHints as ExpressionHints__1_6_0, Result_Facets as Facets__1_6_0, Result_Groups as Groups__1_6_0, Result_Hello as Hello__1_6_0, Result_LocatedMessage as LocatedMessage__1_6_0, Result_McpTestRun as McpTestRun__1_6_0, Result_McpTestTools as McpTestTools__1_6_0, Result_Messages as Messages__1_6_0, Result_ModelUsage as ModelUsage__1_6_0, Result_Mutation as Mutation__1_6_0, Result_OwnerReindexPreview as OwnerReindexPreview__1_6_0, Result_OwnerReindexed as OwnerReindexed__1_6_0, Result_PassageSpans as PassageSpans__1_6_0, Result_Passages as Passages__1_6_0, Result_Ping as Ping__1_6_0, Result_Pong as Pong__1_6_0, Result_Raw as Raw__1_6_0, Result_Related as Related__1_6_0, Result_RetryFailed as RetryFailed__1_6_0, Result_RetryFailedPreview as RetryFailedPreview__1_6_0, Result_Search as Search__1_6_0, Result_Session as Session__1_6_0, Result_SessionMessageSearch as SessionMessageSearch__1_6_0, Result_Status as Status__1_6_0, Result_Token as Token__1_6_0, Result_Tokens as Tokens__1_6_0, Result_Whoami as Whoami__1_6_0} from './v1_6_0/Result.js'

export function convert__result__from__1_6_0(from: Result__1_6_0): api_Result {
    if (from instanceof Hello__1_6_0) {
        return convert__result__hello__from__1_6_0(from)
    }
    if (from instanceof Pong__1_6_0) {
        return convert__result__pong__from__1_6_0(from)
    }
    if (from instanceof Whoami__1_6_0) {
        return convert__result__whoami__from__1_6_0(from)
    }
    if (from instanceof Search__1_6_0) {
        return convert__result__search__from__1_6_0(from)
    }
    if (from instanceof Session__1_6_0) {
        return convert__result__session__from__1_6_0(from)
    }
    if (from instanceof Chunks__1_6_0) {
        return convert__result__chunks__from__1_6_0(from)
    }
    if (from instanceof Messages__1_6_0) {
        return convert__result__messages__from__1_6_0(from)
    }
    if (from instanceof SessionMessageSearch__1_6_0) {
        return convert__result__session_message_search__from__1_6_0(from)
    }
    if (from instanceof Raw__1_6_0) {
        return convert__result__raw__from__1_6_0(from)
    }
    if (from instanceof Related__1_6_0) {
        return convert__result__related__from__1_6_0(from)
    }
    if (from instanceof Facets__1_6_0) {
        return convert__result__facets__from__1_6_0(from)
    }
    if (from instanceof CollectionStatus__1_6_0) {
        return convert__result__collection_status__from__1_6_0(from)
    }
    if (from instanceof Status__1_6_0) {
        return convert__result__status__from__1_6_0(from)
    }
    if (from instanceof Tokens__1_6_0) {
        return convert__result__tokens__from__1_6_0(from)
    }
    if (from instanceof Token__1_6_0) {
        return convert__result__token__from__1_6_0(from)
    }
    if (from instanceof Groups__1_6_0) {
        return convert__result__groups__from__1_6_0(from)
    }
    if (from instanceof Mutation__1_6_0) {
        return convert__result__mutation__from__1_6_0(from)
    }
    if (from instanceof Error__1_6_0) {
        return convert__result__error__from__1_6_0(from)
    }
    if (from instanceof Ping__1_6_0) {
        return convert__result__ping__from__1_6_0(from)
    }
    if (from instanceof Archive__1_6_0) {
        return convert__result__archive__from__1_6_0(from)
    }
    if (from instanceof Activity__1_6_0) {
        return convert__result__activity__from__1_6_0(from)
    }
    if (from instanceof ActivityJobs__1_6_0) {
        return convert__result__activity_jobs__from__1_6_0(from)
    }
    if (from instanceof LocatedMessage__1_6_0) {
        return convert__result__located_message__from__1_6_0(from)
    }
    if (from instanceof RetryFailedPreview__1_6_0) {
        return convert__result__retry_failed_preview__from__1_6_0(from)
    }
    if (from instanceof RetryFailed__1_6_0) {
        return convert__result__retry_failed__from__1_6_0(from)
    }
    if (from instanceof ExpressionHints__1_6_0) {
        return convert__result__expression_hints__from__1_6_0(from)
    }
    if (from instanceof ModelUsage__1_6_0) {
        return convert__result__model_usage__from__1_6_0(from)
    }
    if (from instanceof Passages__1_6_0) {
        return convert__result__passages__from__1_6_0(from)
    }
    if (from instanceof PassageSpans__1_6_0) {
        return convert__result__passage_spans__from__1_6_0(from)
    }
    if (from instanceof OwnerReindexPreview__1_6_0) {
        return convert__result__owner_reindex_preview__from__1_6_0(from)
    }
    if (from instanceof OwnerReindexed__1_6_0) {
        return convert__result__owner_reindexed__from__1_6_0(from)
    }
    if (from instanceof McpTestTools__1_6_0) {
        return convert__result__mcp_test_tools__from__1_6_0(from)
    }
    if (from instanceof McpTestRun__1_6_0) {
        return convert__result__mcp_test_run__from__1_6_0(from)
    }

    throw new Error("Unknown ADT branch: " + from);
}