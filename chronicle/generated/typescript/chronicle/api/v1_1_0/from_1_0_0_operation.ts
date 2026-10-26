import {Operation as Operation__1_0_0, Operation_AcceptInvite as AcceptInvite__1_0_0, Operation_CreateGroup as CreateGroup__1_0_0, Operation_DeleteGroup as DeleteGroup__1_0_0, Operation_Facets as Facets__1_0_0, Operation_GetChunks as GetChunks__1_0_0, Operation_GetMessages as GetMessages__1_0_0, Operation_GetRaw as GetRaw__1_0_0, Operation_GetSession as GetSession__1_0_0, Operation_Hello as Hello__1_0_0, Operation_IngestStatus as IngestStatus__1_0_0, Operation_Invite as Invite__1_0_0, Operation_LeaveGroup as LeaveGroup__1_0_0, Operation_ListGroups as ListGroups__1_0_0, Operation_ListTokens as ListTokens__1_0_0, Operation_Logout as Logout__1_0_0, Operation_MintToken as MintToken__1_0_0, Operation_Ping as Ping__1_0_0, Operation_Pong as Pong__1_0_0, Operation_Purge as Purge__1_0_0, Operation_Receipt as Receipt__1_0_0, Operation_Related as Related__1_0_0, Operation_RemoveMember as RemoveMember__1_0_0, Operation_RetryJob as RetryJob__1_0_0, Operation_RevokeToken as RevokeToken__1_0_0, Operation_Search as Search__1_0_0, Operation_Whoami as Whoami__1_0_0} from '../v1_0_0/Operation.js'
import {Operation as v1_1_0_Operation} from './Operation.js'
import {convert__operation__accept_invite__from__1_0_0} from './from_1_0_0_operation_accept-invite.js'
import {convert__operation__create_group__from__1_0_0} from './from_1_0_0_operation_create-group.js'
import {convert__operation__delete_group__from__1_0_0} from './from_1_0_0_operation_delete-group.js'
import {convert__operation__facets__from__1_0_0} from './from_1_0_0_operation_facets.js'
import {convert__operation__get_chunks__from__1_0_0} from './from_1_0_0_operation_get-chunks.js'
import {convert__operation__get_messages__from__1_0_0} from './from_1_0_0_operation_get-messages.js'
import {convert__operation__get_raw__from__1_0_0} from './from_1_0_0_operation_get-raw.js'
import {convert__operation__get_session__from__1_0_0} from './from_1_0_0_operation_get-session.js'
import {convert__operation__hello__from__1_0_0} from './from_1_0_0_operation_hello.js'
import {convert__operation__ingest_status__from__1_0_0} from './from_1_0_0_operation_ingest-status.js'
import {convert__operation__invite__from__1_0_0} from './from_1_0_0_operation_invite.js'
import {convert__operation__leave_group__from__1_0_0} from './from_1_0_0_operation_leave-group.js'
import {convert__operation__list_groups__from__1_0_0} from './from_1_0_0_operation_list-groups.js'
import {convert__operation__list_tokens__from__1_0_0} from './from_1_0_0_operation_list-tokens.js'
import {convert__operation__logout__from__1_0_0} from './from_1_0_0_operation_logout.js'
import {convert__operation__mint_token__from__1_0_0} from './from_1_0_0_operation_mint-token.js'
import {convert__operation__ping__from__1_0_0} from './from_1_0_0_operation_ping.js'
import {convert__operation__pong__from__1_0_0} from './from_1_0_0_operation_pong.js'
import {convert__operation__purge__from__1_0_0} from './from_1_0_0_operation_purge.js'
import {convert__operation__receipt__from__1_0_0} from './from_1_0_0_operation_receipt.js'
import {convert__operation__related__from__1_0_0} from './from_1_0_0_operation_related.js'
import {convert__operation__remove_member__from__1_0_0} from './from_1_0_0_operation_remove-member.js'
import {convert__operation__retry_job__from__1_0_0} from './from_1_0_0_operation_retry-job.js'
import {convert__operation__revoke_token__from__1_0_0} from './from_1_0_0_operation_revoke-token.js'
import {convert__operation__search__from__1_0_0} from './from_1_0_0_operation_search.js'
import {convert__operation__whoami__from__1_0_0} from './from_1_0_0_operation_whoami.js'

export function convert__operation__from__1_0_0(from: Operation__1_0_0): v1_1_0_Operation {
    if (from instanceof Hello__1_0_0) {
        return convert__operation__hello__from__1_0_0(from)
    }
    if (from instanceof Ping__1_0_0) {
        return convert__operation__ping__from__1_0_0(from)
    }
    if (from instanceof Pong__1_0_0) {
        return convert__operation__pong__from__1_0_0(from)
    }
    if (from instanceof Whoami__1_0_0) {
        return convert__operation__whoami__from__1_0_0(from)
    }
    if (from instanceof Search__1_0_0) {
        return convert__operation__search__from__1_0_0(from)
    }
    if (from instanceof GetSession__1_0_0) {
        return convert__operation__get_session__from__1_0_0(from)
    }
    if (from instanceof GetChunks__1_0_0) {
        return convert__operation__get_chunks__from__1_0_0(from)
    }
    if (from instanceof GetMessages__1_0_0) {
        return convert__operation__get_messages__from__1_0_0(from)
    }
    if (from instanceof GetRaw__1_0_0) {
        return convert__operation__get_raw__from__1_0_0(from)
    }
    if (from instanceof Related__1_0_0) {
        return convert__operation__related__from__1_0_0(from)
    }
    if (from instanceof Facets__1_0_0) {
        return convert__operation__facets__from__1_0_0(from)
    }
    if (from instanceof IngestStatus__1_0_0) {
        return convert__operation__ingest_status__from__1_0_0(from)
    }
    if (from instanceof RetryJob__1_0_0) {
        return convert__operation__retry_job__from__1_0_0(from)
    }
    if (from instanceof ListTokens__1_0_0) {
        return convert__operation__list_tokens__from__1_0_0(from)
    }
    if (from instanceof MintToken__1_0_0) {
        return convert__operation__mint_token__from__1_0_0(from)
    }
    if (from instanceof RevokeToken__1_0_0) {
        return convert__operation__revoke_token__from__1_0_0(from)
    }
    if (from instanceof ListGroups__1_0_0) {
        return convert__operation__list_groups__from__1_0_0(from)
    }
    if (from instanceof CreateGroup__1_0_0) {
        return convert__operation__create_group__from__1_0_0(from)
    }
    if (from instanceof Invite__1_0_0) {
        return convert__operation__invite__from__1_0_0(from)
    }
    if (from instanceof AcceptInvite__1_0_0) {
        return convert__operation__accept_invite__from__1_0_0(from)
    }
    if (from instanceof RemoveMember__1_0_0) {
        return convert__operation__remove_member__from__1_0_0(from)
    }
    if (from instanceof LeaveGroup__1_0_0) {
        return convert__operation__leave_group__from__1_0_0(from)
    }
    if (from instanceof DeleteGroup__1_0_0) {
        return convert__operation__delete_group__from__1_0_0(from)
    }
    if (from instanceof Receipt__1_0_0) {
        return convert__operation__receipt__from__1_0_0(from)
    }
    if (from instanceof Purge__1_0_0) {
        return convert__operation__purge__from__1_0_0(from)
    }
    if (from instanceof Logout__1_0_0) {
        return convert__operation__logout__from__1_0_0(from)
    }

    throw new Error("Unknown ADT branch: " + from);
}