

import { AbstractBaboonJsonCodecs, AbstractBaboonUebaCodecs, BaboonBinCodec, BaboonJsonCodec, BaboonDomainVersion, BaboonMeta, Lazy } from '../../BaboonSharedRuntime.js';
import type { AbstractBaboonConversions } from '../../BaboonSharedRuntime.js';
import { BaboonCodecsFacade } from '../../BaboonCodecsFacade.js';
import { Chunk as ChunkV1_0_0, Chunk_JsonCodec as ChunkV1_0_0_JsonCodec } from './v1_0_0/Chunk.js';
import { ChunksResult as ChunksResultV1_0_0, ChunksResult_JsonCodec as ChunksResultV1_0_0_JsonCodec } from './v1_0_0/ChunksResult.js';
import { ClientEnvelope as ClientEnvelopeV1_0_0, ClientEnvelope_JsonCodec as ClientEnvelopeV1_0_0_JsonCodec } from './v1_0_0/ClientEnvelope.js';
import { Completion as CompletionV1_0_0, Completion_JsonCodec as CompletionV1_0_0_JsonCodec } from './v1_0_0/Completion.js';
import { ContentView as ContentViewV1_0_0, ContentView_JsonCodec as ContentViewV1_0_0_JsonCodec } from './v1_0_0/ContentView.js';
import { Facet as FacetV1_0_0, Facet_JsonCodec as FacetV1_0_0_JsonCodec } from './v1_0_0/Facet.js';
import { FacetsResult as FacetsResultV1_0_0, FacetsResult_JsonCodec as FacetsResultV1_0_0_JsonCodec } from './v1_0_0/FacetsResult.js';
import { Failure as FailureV1_0_0, Failure_JsonCodec as FailureV1_0_0_JsonCodec } from './v1_0_0/Failure.js';
import { GroupInfo as GroupInfoV1_0_0, GroupInfo_JsonCodec as GroupInfoV1_0_0_JsonCodec } from './v1_0_0/GroupInfo.js';
import { GroupsResult as GroupsResultV1_0_0, GroupsResult_JsonCodec as GroupsResultV1_0_0_JsonCodec } from './v1_0_0/GroupsResult.js';
import { IngestReceipt as IngestReceiptV1_0_0, IngestReceipt_JsonCodec as IngestReceiptV1_0_0_JsonCodec } from './v1_0_0/IngestReceipt.js';
import { IngestRequest as IngestRequestV1_0_0, IngestRequest_JsonCodec as IngestRequestV1_0_0_JsonCodec } from './v1_0_0/IngestRequest.js';
import { InviteInfo as InviteInfoV1_0_0, InviteInfo_JsonCodec as InviteInfoV1_0_0_JsonCodec } from './v1_0_0/InviteInfo.js';
import { JobInfo as JobInfoV1_0_0, JobInfo_JsonCodec as JobInfoV1_0_0_JsonCodec } from './v1_0_0/JobInfo.js';
import { JobState as JobStateV1_0_0, JobState_JsonCodec as JobStateV1_0_0_JsonCodec } from './v1_0_0/JobState.js';
import { LoginRequest as LoginRequestV1_0_0, LoginRequest_JsonCodec as LoginRequestV1_0_0_JsonCodec } from './v1_0_0/LoginRequest.js';
import { LoginResponse as LoginResponseV1_0_0, LoginResponse_JsonCodec as LoginResponseV1_0_0_JsonCodec } from './v1_0_0/LoginResponse.js';
import { Message as MessageV1_0_0, Message_JsonCodec as MessageV1_0_0_JsonCodec } from './v1_0_0/Message.js';
import { MessagesResult as MessagesResultV1_0_0, MessagesResult_JsonCodec as MessagesResultV1_0_0_JsonCodec } from './v1_0_0/MessagesResult.js';
import { Metadata as MetadataV1_0_0, Metadata_JsonCodec as MetadataV1_0_0_JsonCodec } from './v1_0_0/Metadata.js';
import { MutationReceipt as MutationReceiptV1_0_0, MutationReceipt_JsonCodec as MutationReceiptV1_0_0_JsonCodec } from './v1_0_0/MutationReceipt.js';
import { Operation as OperationV1_0_0, Operation_JsonCodec as OperationV1_0_0_JsonCodec } from './v1_0_0/Operation.js';
import { RawFile as RawFileV1_0_0, RawFile_JsonCodec as RawFileV1_0_0_JsonCodec } from './v1_0_0/RawFile.js';
import { RawResult as RawResultV1_0_0, RawResult_JsonCodec as RawResultV1_0_0_JsonCodec } from './v1_0_0/RawResult.js';
import { RelatedResult as RelatedResultV1_0_0, RelatedResult_JsonCodec as RelatedResultV1_0_0_JsonCodec } from './v1_0_0/RelatedResult.js';
import { Result as ResultV1_0_0, Result_JsonCodec as ResultV1_0_0_JsonCodec } from './v1_0_0/Result.js';
import { Scope as ScopeV1_0_0, Scope_JsonCodec as ScopeV1_0_0_JsonCodec } from './v1_0_0/Scope.js';
import { SearchFilter as SearchFilterV1_0_0, SearchFilter_JsonCodec as SearchFilterV1_0_0_JsonCodec } from './v1_0_0/SearchFilter.js';
import { SearchHit as SearchHitV1_0_0, SearchHit_JsonCodec as SearchHitV1_0_0_JsonCodec } from './v1_0_0/SearchHit.js';
import { SearchMode as SearchModeV1_0_0, SearchMode_JsonCodec as SearchModeV1_0_0_JsonCodec } from './v1_0_0/SearchMode.js';
import { SearchQuery as SearchQueryV1_0_0, SearchQuery_JsonCodec as SearchQueryV1_0_0_JsonCodec } from './v1_0_0/SearchQuery.js';
import { SearchResult as SearchResultV1_0_0, SearchResult_JsonCodec as SearchResultV1_0_0_JsonCodec } from './v1_0_0/SearchResult.js';
import { ServerEnvelope as ServerEnvelopeV1_0_0, ServerEnvelope_JsonCodec as ServerEnvelopeV1_0_0_JsonCodec } from './v1_0_0/ServerEnvelope.js';
import { SessionInfo as SessionInfoV1_0_0, SessionInfo_JsonCodec as SessionInfoV1_0_0_JsonCodec } from './v1_0_0/SessionInfo.js';
import { SessionResult as SessionResultV1_0_0, SessionResult_JsonCodec as SessionResultV1_0_0_JsonCodec } from './v1_0_0/SessionResult.js';
import { SourceFormat as SourceFormatV1_0_0, SourceFormat_JsonCodec as SourceFormatV1_0_0_JsonCodec } from './v1_0_0/SourceFormat.js';
import { SourceIdentity as SourceIdentityV1_0_0, SourceIdentity_JsonCodec as SourceIdentityV1_0_0_JsonCodec } from './v1_0_0/SourceIdentity.js';
import { Span as SpanV1_0_0, Span_JsonCodec as SpanV1_0_0_JsonCodec } from './v1_0_0/Span.js';
import { StatusResult as StatusResultV1_0_0, StatusResult_JsonCodec as StatusResultV1_0_0_JsonCodec } from './v1_0_0/StatusResult.js';
import { TokenInfo as TokenInfoV1_0_0, TokenInfo_JsonCodec as TokenInfoV1_0_0_JsonCodec } from './v1_0_0/TokenInfo.js';
import { TokenResult as TokenResultV1_0_0, TokenResult_JsonCodec as TokenResultV1_0_0_JsonCodec } from './v1_0_0/TokenResult.js';
import { TokensResult as TokensResultV1_0_0, TokensResult_JsonCodec as TokensResultV1_0_0_JsonCodec } from './v1_0_0/TokensResult.js';
import { UserInfo as UserInfoV1_0_0, UserInfo_JsonCodec as UserInfoV1_0_0_JsonCodec } from './v1_0_0/UserInfo.js';
import { VersionInfo as VersionInfoV1_0_0, VersionInfo_JsonCodec as VersionInfoV1_0_0_JsonCodec } from './v1_0_0/VersionInfo.js';
import { Chunk as ChunkV1_1_0, Chunk_JsonCodec as ChunkV1_1_0_JsonCodec } from './v1_1_0/Chunk.js';
import { ChunksResult as ChunksResultV1_1_0, ChunksResult_JsonCodec as ChunksResultV1_1_0_JsonCodec } from './v1_1_0/ChunksResult.js';
import { ClientEnvelope as ClientEnvelopeV1_1_0, ClientEnvelope_JsonCodec as ClientEnvelopeV1_1_0_JsonCodec } from './v1_1_0/ClientEnvelope.js';
import { Completion as CompletionV1_1_0, Completion_JsonCodec as CompletionV1_1_0_JsonCodec } from './v1_1_0/Completion.js';
import { ContentView as ContentViewV1_1_0, ContentView_JsonCodec as ContentViewV1_1_0_JsonCodec } from './v1_1_0/ContentView.js';
import { Facet as FacetV1_1_0, Facet_JsonCodec as FacetV1_1_0_JsonCodec } from './v1_1_0/Facet.js';
import { FacetsResult as FacetsResultV1_1_0, FacetsResult_JsonCodec as FacetsResultV1_1_0_JsonCodec } from './v1_1_0/FacetsResult.js';
import { Failure as FailureV1_1_0, Failure_JsonCodec as FailureV1_1_0_JsonCodec } from './v1_1_0/Failure.js';
import { GroupInfo as GroupInfoV1_1_0, GroupInfo_JsonCodec as GroupInfoV1_1_0_JsonCodec } from './v1_1_0/GroupInfo.js';
import { GroupsResult as GroupsResultV1_1_0, GroupsResult_JsonCodec as GroupsResultV1_1_0_JsonCodec } from './v1_1_0/GroupsResult.js';
import { IngestReceipt as IngestReceiptV1_1_0, IngestReceipt_JsonCodec as IngestReceiptV1_1_0_JsonCodec } from './v1_1_0/IngestReceipt.js';
import { IngestRequest as IngestRequestV1_1_0, IngestRequest_JsonCodec as IngestRequestV1_1_0_JsonCodec } from './v1_1_0/IngestRequest.js';
import { InviteInfo as InviteInfoV1_1_0, InviteInfo_JsonCodec as InviteInfoV1_1_0_JsonCodec } from './v1_1_0/InviteInfo.js';
import { JobInfo as JobInfoV1_1_0, JobInfo_JsonCodec as JobInfoV1_1_0_JsonCodec } from './v1_1_0/JobInfo.js';
import { JobState as JobStateV1_1_0, JobState_JsonCodec as JobStateV1_1_0_JsonCodec } from './v1_1_0/JobState.js';
import { LoginRequest as LoginRequestV1_1_0, LoginRequest_JsonCodec as LoginRequestV1_1_0_JsonCodec } from './v1_1_0/LoginRequest.js';
import { LoginResponse as LoginResponseV1_1_0, LoginResponse_JsonCodec as LoginResponseV1_1_0_JsonCodec } from './v1_1_0/LoginResponse.js';
import { Message as MessageV1_1_0, Message_JsonCodec as MessageV1_1_0_JsonCodec } from './v1_1_0/Message.js';
import { MessagesResult as MessagesResultV1_1_0, MessagesResult_JsonCodec as MessagesResultV1_1_0_JsonCodec } from './v1_1_0/MessagesResult.js';
import { Metadata as MetadataV1_1_0, Metadata_JsonCodec as MetadataV1_1_0_JsonCodec } from './v1_1_0/Metadata.js';
import { MutationReceipt as MutationReceiptV1_1_0, MutationReceipt_JsonCodec as MutationReceiptV1_1_0_JsonCodec } from './v1_1_0/MutationReceipt.js';
import { Operation as OperationV1_1_0, Operation_JsonCodec as OperationV1_1_0_JsonCodec } from './v1_1_0/Operation.js';
import { RawFile as RawFileV1_1_0, RawFile_JsonCodec as RawFileV1_1_0_JsonCodec } from './v1_1_0/RawFile.js';
import { RawResult as RawResultV1_1_0, RawResult_JsonCodec as RawResultV1_1_0_JsonCodec } from './v1_1_0/RawResult.js';
import { RelatedResult as RelatedResultV1_1_0, RelatedResult_JsonCodec as RelatedResultV1_1_0_JsonCodec } from './v1_1_0/RelatedResult.js';
import { Result as ResultV1_1_0, Result_JsonCodec as ResultV1_1_0_JsonCodec } from './v1_1_0/Result.js';
import { Scope as ScopeV1_1_0, Scope_JsonCodec as ScopeV1_1_0_JsonCodec } from './v1_1_0/Scope.js';
import { SearchCountScope as SearchCountScopeV1_1_0, SearchCountScope_JsonCodec as SearchCountScopeV1_1_0_JsonCodec } from './v1_1_0/SearchCountScope.js';
import { SearchFilter as SearchFilterV1_1_0, SearchFilter_JsonCodec as SearchFilterV1_1_0_JsonCodec } from './v1_1_0/SearchFilter.js';
import { SearchHit as SearchHitV1_1_0, SearchHit_JsonCodec as SearchHitV1_1_0_JsonCodec } from './v1_1_0/SearchHit.js';
import { SearchMode as SearchModeV1_1_0, SearchMode_JsonCodec as SearchModeV1_1_0_JsonCodec } from './v1_1_0/SearchMode.js';
import { SearchQuery as SearchQueryV1_1_0, SearchQuery_JsonCodec as SearchQueryV1_1_0_JsonCodec } from './v1_1_0/SearchQuery.js';
import { SearchResult as SearchResultV1_1_0, SearchResult_JsonCodec as SearchResultV1_1_0_JsonCodec } from './v1_1_0/SearchResult.js';
import { ServerEnvelope as ServerEnvelopeV1_1_0, ServerEnvelope_JsonCodec as ServerEnvelopeV1_1_0_JsonCodec } from './v1_1_0/ServerEnvelope.js';
import { SessionInfo as SessionInfoV1_1_0, SessionInfo_JsonCodec as SessionInfoV1_1_0_JsonCodec } from './v1_1_0/SessionInfo.js';
import { SessionResult as SessionResultV1_1_0, SessionResult_JsonCodec as SessionResultV1_1_0_JsonCodec } from './v1_1_0/SessionResult.js';
import { SourceFormat as SourceFormatV1_1_0, SourceFormat_JsonCodec as SourceFormatV1_1_0_JsonCodec } from './v1_1_0/SourceFormat.js';
import { SourceIdentity as SourceIdentityV1_1_0, SourceIdentity_JsonCodec as SourceIdentityV1_1_0_JsonCodec } from './v1_1_0/SourceIdentity.js';
import { Span as SpanV1_1_0, Span_JsonCodec as SpanV1_1_0_JsonCodec } from './v1_1_0/Span.js';
import { StatusResult as StatusResultV1_1_0, StatusResult_JsonCodec as StatusResultV1_1_0_JsonCodec } from './v1_1_0/StatusResult.js';
import { TokenInfo as TokenInfoV1_1_0, TokenInfo_JsonCodec as TokenInfoV1_1_0_JsonCodec } from './v1_1_0/TokenInfo.js';
import { TokenResult as TokenResultV1_1_0, TokenResult_JsonCodec as TokenResultV1_1_0_JsonCodec } from './v1_1_0/TokenResult.js';
import { TokensResult as TokensResultV1_1_0, TokensResult_JsonCodec as TokensResultV1_1_0_JsonCodec } from './v1_1_0/TokensResult.js';
import { UserInfo as UserInfoV1_1_0, UserInfo_JsonCodec as UserInfoV1_1_0_JsonCodec } from './v1_1_0/UserInfo.js';
import { VersionInfo as VersionInfoV1_1_0, VersionInfo_JsonCodec as VersionInfoV1_1_0_JsonCodec } from './v1_1_0/VersionInfo.js';
import { Chunk as ChunkV1_2_0, Chunk_JsonCodec as ChunkV1_2_0_JsonCodec } from './v1_2_0/Chunk.js';
import { ChunksResult as ChunksResultV1_2_0, ChunksResult_JsonCodec as ChunksResultV1_2_0_JsonCodec } from './v1_2_0/ChunksResult.js';
import { ClientEnvelope as ClientEnvelopeV1_2_0, ClientEnvelope_JsonCodec as ClientEnvelopeV1_2_0_JsonCodec } from './v1_2_0/ClientEnvelope.js';
import { CollectorCounters as CollectorCountersV1_2_0, CollectorCounters_JsonCodec as CollectorCountersV1_2_0_JsonCodec } from './v1_2_0/CollectorCounters.js';
import { CollectorPhase as CollectorPhaseV1_2_0, CollectorPhase_JsonCodec as CollectorPhaseV1_2_0_JsonCodec } from './v1_2_0/CollectorPhase.js';
import { CollectorProgressAck as CollectorProgressAckV1_2_0, CollectorProgressAck_JsonCodec as CollectorProgressAckV1_2_0_JsonCodec } from './v1_2_0/CollectorProgressAck.js';
import { CollectorProgressUpdate as CollectorProgressUpdateV1_2_0, CollectorProgressUpdate_JsonCodec as CollectorProgressUpdateV1_2_0_JsonCodec } from './v1_2_0/CollectorProgressUpdate.js';
import { CollectorStatus as CollectorStatusV1_2_0, CollectorStatus_JsonCodec as CollectorStatusV1_2_0_JsonCodec } from './v1_2_0/CollectorStatus.js';
import { CollectorStatusResult as CollectorStatusResultV1_2_0, CollectorStatusResult_JsonCodec as CollectorStatusResultV1_2_0_JsonCodec } from './v1_2_0/CollectorStatusResult.js';
import { Completion as CompletionV1_2_0, Completion_JsonCodec as CompletionV1_2_0_JsonCodec } from './v1_2_0/Completion.js';
import { ContentView as ContentViewV1_2_0, ContentView_JsonCodec as ContentViewV1_2_0_JsonCodec } from './v1_2_0/ContentView.js';
import { Facet as FacetV1_2_0, Facet_JsonCodec as FacetV1_2_0_JsonCodec } from './v1_2_0/Facet.js';
import { FacetsResult as FacetsResultV1_2_0, FacetsResult_JsonCodec as FacetsResultV1_2_0_JsonCodec } from './v1_2_0/FacetsResult.js';
import { Failure as FailureV1_2_0, Failure_JsonCodec as FailureV1_2_0_JsonCodec } from './v1_2_0/Failure.js';
import { GroupInfo as GroupInfoV1_2_0, GroupInfo_JsonCodec as GroupInfoV1_2_0_JsonCodec } from './v1_2_0/GroupInfo.js';
import { GroupsResult as GroupsResultV1_2_0, GroupsResult_JsonCodec as GroupsResultV1_2_0_JsonCodec } from './v1_2_0/GroupsResult.js';
import { IngestReceipt as IngestReceiptV1_2_0, IngestReceipt_JsonCodec as IngestReceiptV1_2_0_JsonCodec } from './v1_2_0/IngestReceipt.js';
import { IngestRequest as IngestRequestV1_2_0, IngestRequest_JsonCodec as IngestRequestV1_2_0_JsonCodec } from './v1_2_0/IngestRequest.js';
import { InviteInfo as InviteInfoV1_2_0, InviteInfo_JsonCodec as InviteInfoV1_2_0_JsonCodec } from './v1_2_0/InviteInfo.js';
import { JobInfo as JobInfoV1_2_0, JobInfo_JsonCodec as JobInfoV1_2_0_JsonCodec } from './v1_2_0/JobInfo.js';
import { JobState as JobStateV1_2_0, JobState_JsonCodec as JobStateV1_2_0_JsonCodec } from './v1_2_0/JobState.js';
import { ListedToken as ListedTokenV1_2_0, ListedToken_JsonCodec as ListedTokenV1_2_0_JsonCodec } from './v1_2_0/ListedToken.js';
import { LoginRequest as LoginRequestV1_2_0, LoginRequest_JsonCodec as LoginRequestV1_2_0_JsonCodec } from './v1_2_0/LoginRequest.js';
import { LoginResponse as LoginResponseV1_2_0, LoginResponse_JsonCodec as LoginResponseV1_2_0_JsonCodec } from './v1_2_0/LoginResponse.js';
import { Message as MessageV1_2_0, Message_JsonCodec as MessageV1_2_0_JsonCodec } from './v1_2_0/Message.js';
import { MessagesResult as MessagesResultV1_2_0, MessagesResult_JsonCodec as MessagesResultV1_2_0_JsonCodec } from './v1_2_0/MessagesResult.js';
import { Metadata as MetadataV1_2_0, Metadata_JsonCodec as MetadataV1_2_0_JsonCodec } from './v1_2_0/Metadata.js';
import { MutationReceipt as MutationReceiptV1_2_0, MutationReceipt_JsonCodec as MutationReceiptV1_2_0_JsonCodec } from './v1_2_0/MutationReceipt.js';
import { Operation as OperationV1_2_0, Operation_JsonCodec as OperationV1_2_0_JsonCodec } from './v1_2_0/Operation.js';
import { RawFile as RawFileV1_2_0, RawFile_JsonCodec as RawFileV1_2_0_JsonCodec } from './v1_2_0/RawFile.js';
import { RawResult as RawResultV1_2_0, RawResult_JsonCodec as RawResultV1_2_0_JsonCodec } from './v1_2_0/RawResult.js';
import { RelatedResult as RelatedResultV1_2_0, RelatedResult_JsonCodec as RelatedResultV1_2_0_JsonCodec } from './v1_2_0/RelatedResult.js';
import { Result as ResultV1_2_0, Result_JsonCodec as ResultV1_2_0_JsonCodec } from './v1_2_0/Result.js';
import { Scope as ScopeV1_2_0, Scope_JsonCodec as ScopeV1_2_0_JsonCodec } from './v1_2_0/Scope.js';
import { SearchCountScope as SearchCountScopeV1_2_0, SearchCountScope_JsonCodec as SearchCountScopeV1_2_0_JsonCodec } from './v1_2_0/SearchCountScope.js';
import { SearchFilter as SearchFilterV1_2_0, SearchFilter_JsonCodec as SearchFilterV1_2_0_JsonCodec } from './v1_2_0/SearchFilter.js';
import { SearchHit as SearchHitV1_2_0, SearchHit_JsonCodec as SearchHitV1_2_0_JsonCodec } from './v1_2_0/SearchHit.js';
import { SearchMode as SearchModeV1_2_0, SearchMode_JsonCodec as SearchModeV1_2_0_JsonCodec } from './v1_2_0/SearchMode.js';
import { SearchQuery as SearchQueryV1_2_0, SearchQuery_JsonCodec as SearchQueryV1_2_0_JsonCodec } from './v1_2_0/SearchQuery.js';
import { SearchResult as SearchResultV1_2_0, SearchResult_JsonCodec as SearchResultV1_2_0_JsonCodec } from './v1_2_0/SearchResult.js';
import { ServerEnvelope as ServerEnvelopeV1_2_0, ServerEnvelope_JsonCodec as ServerEnvelopeV1_2_0_JsonCodec } from './v1_2_0/ServerEnvelope.js';
import { SessionInfo as SessionInfoV1_2_0, SessionInfo_JsonCodec as SessionInfoV1_2_0_JsonCodec } from './v1_2_0/SessionInfo.js';
import { SessionResult as SessionResultV1_2_0, SessionResult_JsonCodec as SessionResultV1_2_0_JsonCodec } from './v1_2_0/SessionResult.js';
import { SourceFormat as SourceFormatV1_2_0, SourceFormat_JsonCodec as SourceFormatV1_2_0_JsonCodec } from './v1_2_0/SourceFormat.js';
import { SourceIdentity as SourceIdentityV1_2_0, SourceIdentity_JsonCodec as SourceIdentityV1_2_0_JsonCodec } from './v1_2_0/SourceIdentity.js';
import { Span as SpanV1_2_0, Span_JsonCodec as SpanV1_2_0_JsonCodec } from './v1_2_0/Span.js';
import { StatusResult as StatusResultV1_2_0, StatusResult_JsonCodec as StatusResultV1_2_0_JsonCodec } from './v1_2_0/StatusResult.js';
import { TokenInfo as TokenInfoV1_2_0, TokenInfo_JsonCodec as TokenInfoV1_2_0_JsonCodec } from './v1_2_0/TokenInfo.js';
import { TokenResult as TokenResultV1_2_0, TokenResult_JsonCodec as TokenResultV1_2_0_JsonCodec } from './v1_2_0/TokenResult.js';
import { TokenSource as TokenSourceV1_2_0, TokenSource_JsonCodec as TokenSourceV1_2_0_JsonCodec } from './v1_2_0/TokenSource.js';
import { TokensResult as TokensResultV1_2_0, TokensResult_JsonCodec as TokensResultV1_2_0_JsonCodec } from './v1_2_0/TokensResult.js';
import { UserInfo as UserInfoV1_2_0, UserInfo_JsonCodec as UserInfoV1_2_0_JsonCodec } from './v1_2_0/UserInfo.js';
import { VersionInfo as VersionInfoV1_2_0, VersionInfo_JsonCodec as VersionInfoV1_2_0_JsonCodec } from './v1_2_0/VersionInfo.js';
import { ActivityCollector, ActivityCollector_JsonCodec } from './ActivityCollector.js';
import { ActivityJob, ActivityJob_JsonCodec } from './ActivityJob.js';
import { ActivityJobClass, ActivityJobClass_JsonCodec } from './ActivityJobClass.js';
import { ActivityJobScope, ActivityJobScope_JsonCodec } from './ActivityJobScope.js';
import { ActivityJobsQuery, ActivityJobsQuery_JsonCodec } from './ActivityJobsQuery.js';
import { ActivityJobsResult, ActivityJobsResult_JsonCodec } from './ActivityJobsResult.js';
import { ActivityQuery, ActivityQuery_JsonCodec } from './ActivityQuery.js';
import { ActivityResult, ActivityResult_JsonCodec } from './ActivityResult.js';
import { ArchiveQuery, ArchiveQuery_JsonCodec } from './ArchiveQuery.js';
import { ArchiveResult, ArchiveResult_JsonCodec } from './ArchiveResult.js';
import { ArchiveRow, ArchiveRow_JsonCodec } from './ArchiveRow.js';
import { ArchiveSort, ArchiveSort_JsonCodec } from './ArchiveSort.js';
import { ArchiveTextScope, ArchiveTextScope_JsonCodec } from './ArchiveTextScope.js';
import { Chunk, Chunk_JsonCodec } from './Chunk.js';
import { ChunksResult, ChunksResult_JsonCodec } from './ChunksResult.js';
import { ClientEnvelope, ClientEnvelope_JsonCodec } from './ClientEnvelope.js';
import { CollectorCounters, CollectorCounters_JsonCodec } from './CollectorCounters.js';
import { CollectorPhase, CollectorPhase_JsonCodec } from './CollectorPhase.js';
import { CollectorProgressAck, CollectorProgressAck_JsonCodec } from './CollectorProgressAck.js';
import { CollectorProgressUpdate, CollectorProgressUpdate_JsonCodec } from './CollectorProgressUpdate.js';
import { CollectorStatus, CollectorStatus_JsonCodec } from './CollectorStatus.js';
import { CollectorStatusResult, CollectorStatusResult_JsonCodec } from './CollectorStatusResult.js';
import { Completion, Completion_JsonCodec } from './Completion.js';
import { ContentView, ContentView_JsonCodec } from './ContentView.js';
import { Facet, Facet_JsonCodec } from './Facet.js';
import { FacetsResult, FacetsResult_JsonCodec } from './FacetsResult.js';
import { Failure, Failure_JsonCodec } from './Failure.js';
import { GroupInfo, GroupInfo_JsonCodec } from './GroupInfo.js';
import { GroupsResult, GroupsResult_JsonCodec } from './GroupsResult.js';
import { IngestReceipt, IngestReceipt_JsonCodec } from './IngestReceipt.js';
import { IngestRequest, IngestRequest_JsonCodec } from './IngestRequest.js';
import { InviteInfo, InviteInfo_JsonCodec } from './InviteInfo.js';
import { JobCounts, JobCounts_JsonCodec } from './JobCounts.js';
import { JobInfo, JobInfo_JsonCodec } from './JobInfo.js';
import { JobState, JobState_JsonCodec } from './JobState.js';
import { ListedToken, ListedToken_JsonCodec } from './ListedToken.js';
import { LoginRequest, LoginRequest_JsonCodec } from './LoginRequest.js';
import { LoginResponse, LoginResponse_JsonCodec } from './LoginResponse.js';
import { Message, Message_JsonCodec } from './Message.js';
import { MessageLocation, MessageLocation_JsonCodec } from './MessageLocation.js';
import { MessagesResult, MessagesResult_JsonCodec } from './MessagesResult.js';
import { Metadata, Metadata_JsonCodec } from './Metadata.js';
import { MutationReceipt, MutationReceipt_JsonCodec } from './MutationReceipt.js';
import { Operation, Operation_JsonCodec } from './Operation.js';
import { RawFile, RawFile_JsonCodec } from './RawFile.js';
import { RawResult, RawResult_JsonCodec } from './RawResult.js';
import { RelatedResult, RelatedResult_JsonCodec } from './RelatedResult.js';
import { Result, Result_JsonCodec } from './Result.js';
import { Scope, Scope_JsonCodec } from './Scope.js';
import { SearchCountScope, SearchCountScope_JsonCodec } from './SearchCountScope.js';
import { SearchFilter, SearchFilter_JsonCodec } from './SearchFilter.js';
import { SearchHit, SearchHit_JsonCodec } from './SearchHit.js';
import { SearchMode, SearchMode_JsonCodec } from './SearchMode.js';
import { SearchQuery, SearchQuery_JsonCodec } from './SearchQuery.js';
import { SearchResult, SearchResult_JsonCodec } from './SearchResult.js';
import { ServerEnvelope, ServerEnvelope_JsonCodec } from './ServerEnvelope.js';
import { SessionInfo, SessionInfo_JsonCodec } from './SessionInfo.js';
import { SessionResult, SessionResult_JsonCodec } from './SessionResult.js';
import { SortDirection, SortDirection_JsonCodec } from './SortDirection.js';
import { SourceFormat, SourceFormat_JsonCodec } from './SourceFormat.js';
import { SourceIdentity, SourceIdentity_JsonCodec } from './SourceIdentity.js';
import { Span, Span_JsonCodec } from './Span.js';
import { StatusResult, StatusResult_JsonCodec } from './StatusResult.js';
import { TokenInfo, TokenInfo_JsonCodec } from './TokenInfo.js';
import { TokenResult, TokenResult_JsonCodec } from './TokenResult.js';
import { TokenSource, TokenSource_JsonCodec } from './TokenSource.js';
import { TokensResult, TokensResult_JsonCodec } from './TokensResult.js';
import { UserInfo, UserInfo_JsonCodec } from './UserInfo.js';
import { VersionInfo, VersionInfo_JsonCodec } from './VersionInfo.js';

class DomainChronicleApiV1_0_0JsonCodecs extends AbstractBaboonJsonCodecs {
    constructor() {
        super();
        this.register(ChunkV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunkV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ChunksResultV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunksResultV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ClientEnvelopeV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ClientEnvelopeV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CompletionV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CompletionV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ContentViewV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ContentViewV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetsResultV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetsResultV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FailureV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FailureV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupInfoV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupInfoV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupsResultV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupsResultV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestReceiptV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestReceiptV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestRequestV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestRequestV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(InviteInfoV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => InviteInfoV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobInfoV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobInfoV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobStateV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobStateV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginRequestV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginRequestV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginResponseV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginResponseV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessageV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessagesResultV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessagesResultV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MetadataV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MetadataV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MutationReceiptV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MutationReceiptV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OperationV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OperationV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawFileV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawFileV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawResultV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawResultV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RelatedResultV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RelatedResultV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ResultV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ResultV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ScopeV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ScopeV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchFilterV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchFilterV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchHitV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchHitV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchModeV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchModeV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchQueryV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchQueryV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchResultV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchResultV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ServerEnvelopeV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ServerEnvelopeV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionInfoV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionInfoV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionResultV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionResultV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceFormatV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceFormatV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceIdentityV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceIdentityV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SpanV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SpanV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(StatusResultV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => StatusResultV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenInfoV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenInfoV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenResultV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenResultV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokensResultV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokensResultV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(UserInfoV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => UserInfoV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(VersionInfoV1_0_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => VersionInfoV1_0_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
    }
}

class DomainChronicleApiV1_0_0UebaCodecs extends AbstractBaboonUebaCodecs {
    constructor() {
        super();
        
    }
}

class DomainChronicleApiV1_0_0Conversions implements AbstractBaboonConversions {
    public versionsFrom(): string[] { return []; }
    public versionTo(): string { return '1.0.0'; }
}

class DomainChronicleApiV1_0_0Meta implements BaboonMeta {
    private static readonly SAME_IN: { readonly [typeId: string]: readonly string[] } = {
        "chronicle.api/:#Chunk": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ChunksResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ClientEnvelope": ['1.0.0', '1.1.0'],
        "chronicle.api/:#Completion": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ContentView": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Facet": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#FacetsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Failure": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#GroupInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#GroupsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#IngestReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#IngestRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#InviteInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#JobInfo": ['1.0.0', '1.1.0'],
        "chronicle.api/:#JobState": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#LoginRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#LoginResponse": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Message": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#MessagesResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Metadata": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#MutationReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Operation": ['1.0.0', '1.1.0'],
        "chronicle.api/:#RawFile": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#RawResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#RelatedResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Result": ['1.0.0'],
        "chronicle.api/:#Scope": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchFilter": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchHit": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchMode": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchQuery": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchResult": ['1.0.0'],
        "chronicle.api/:#ServerEnvelope": ['1.0.0'],
        "chronicle.api/:#SessionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SessionResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SourceFormat": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SourceIdentity": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Span": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#StatusResult": ['1.0.0', '1.1.0'],
        "chronicle.api/:#TokenInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#TokenResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#TokensResult": ['1.0.0', '1.1.0'],
        "chronicle.api/:#UserInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#VersionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Invite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Logout": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Purge": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Search": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Chunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Error": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Groups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Messages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Mutation": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Raw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Search": ['1.0.0'],
        "chronicle.api/[chronicle.api/:#Result]#Session": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Status": ['1.0.0', '1.1.0'],
        "chronicle.api/[chronicle.api/:#Result]#Token": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Tokens": ['1.0.0', '1.1.0'],
        "chronicle.api/[chronicle.api/:#Result]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "chronicle.api/:#Chunk": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#ChunksResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#ClientEnvelope": { '1.0.0': 'identical', '1.1.0': 'identical' },
        "chronicle.api/:#Completion": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#ContentView": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Facet": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#FacetsResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Failure": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#GroupInfo": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#GroupsResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#IngestReceipt": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#IngestRequest": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#InviteInfo": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#JobInfo": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'prefix-compact', '1.3.0': 'prefix-compact' },
        "chronicle.api/:#JobState": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#LoginRequest": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#LoginResponse": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Message": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#MessagesResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Metadata": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#MutationReceipt": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Operation": { '1.0.0': 'identical', '1.1.0': 'identical' },
        "chronicle.api/:#RawFile": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#RawResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#RelatedResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Result": { '1.0.0': 'identical', '1.1.0': 'json-additive' },
        "chronicle.api/:#Scope": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchFilter": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchHit": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchMode": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchQuery": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchResult": { '1.0.0': 'identical', '1.1.0': 'prefix-compact', '1.2.0': 'prefix-compact', '1.3.0': 'prefix-compact' },
        "chronicle.api/:#ServerEnvelope": { '1.0.0': 'identical', '1.1.0': 'json-additive' },
        "chronicle.api/:#SessionInfo": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SessionResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SourceFormat": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SourceIdentity": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Span": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#StatusResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'json-additive', '1.3.0': 'json-additive' },
        "chronicle.api/:#TokenInfo": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#TokenResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#TokensResult": { '1.0.0': 'identical', '1.1.0': 'identical' },
        "chronicle.api/:#UserInfo": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#VersionInfo": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Facets": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Hello": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Invite": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Logout": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Ping": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Pong": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Purge": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Related": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Search": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Chunks": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Error": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Facets": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Groups": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Hello": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Messages": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Mutation": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Ping": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Pong": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Raw": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Related": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Search": { '1.0.0': 'identical', '1.1.0': 'json-additive', '1.2.0': 'json-additive', '1.3.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Session": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Status": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'json-additive', '1.3.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Token": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Tokens": { '1.0.0': 'identical', '1.1.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Whoami": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainChronicleApiV1_0_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainChronicleApiV1_0_0Meta.FORWARD[typeId] ?? {}; }
}

class DomainChronicleApiV1_1_0JsonCodecs extends AbstractBaboonJsonCodecs {
    constructor() {
        super();
        this.register(ChunkV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunkV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ChunksResultV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunksResultV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ClientEnvelopeV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ClientEnvelopeV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CompletionV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CompletionV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ContentViewV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ContentViewV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetsResultV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetsResultV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FailureV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FailureV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupInfoV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupInfoV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupsResultV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupsResultV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestReceiptV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestReceiptV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestRequestV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestRequestV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(InviteInfoV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => InviteInfoV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobInfoV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobInfoV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobStateV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobStateV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginRequestV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginRequestV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginResponseV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginResponseV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessageV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessagesResultV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessagesResultV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MetadataV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MetadataV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MutationReceiptV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MutationReceiptV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OperationV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OperationV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawFileV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawFileV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawResultV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawResultV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RelatedResultV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RelatedResultV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ResultV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ResultV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ScopeV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ScopeV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchCountScopeV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchCountScopeV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchFilterV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchFilterV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchHitV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchHitV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchModeV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchModeV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchQueryV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchQueryV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchResultV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchResultV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ServerEnvelopeV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ServerEnvelopeV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionInfoV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionInfoV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionResultV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionResultV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceFormatV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceFormatV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceIdentityV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceIdentityV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SpanV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SpanV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(StatusResultV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => StatusResultV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenInfoV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenInfoV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenResultV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenResultV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokensResultV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokensResultV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(UserInfoV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => UserInfoV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(VersionInfoV1_1_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => VersionInfoV1_1_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
    }
}

class DomainChronicleApiV1_1_0UebaCodecs extends AbstractBaboonUebaCodecs {
    constructor() {
        super();
        
    }
}

class DomainChronicleApiV1_1_0Conversions implements AbstractBaboonConversions {
    public versionsFrom(): string[] { return []; }
    public versionTo(): string { return '1.1.0'; }
}

class DomainChronicleApiV1_1_0Meta implements BaboonMeta {
    private static readonly SAME_IN: { readonly [typeId: string]: readonly string[] } = {
        "chronicle.api/:#Chunk": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ChunksResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ClientEnvelope": ['1.0.0', '1.1.0'],
        "chronicle.api/:#Completion": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ContentView": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Facet": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#FacetsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Failure": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#GroupInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#GroupsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#IngestReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#IngestRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#InviteInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#JobInfo": ['1.0.0', '1.1.0'],
        "chronicle.api/:#JobState": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#LoginRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#LoginResponse": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Message": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#MessagesResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Metadata": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#MutationReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Operation": ['1.0.0', '1.1.0'],
        "chronicle.api/:#RawFile": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#RawResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#RelatedResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Result": ['1.1.0'],
        "chronicle.api/:#Scope": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchCountScope": ['1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchFilter": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchHit": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchMode": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchQuery": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchResult": ['1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ServerEnvelope": ['1.1.0'],
        "chronicle.api/:#SessionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SessionResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SourceFormat": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SourceIdentity": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Span": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#StatusResult": ['1.0.0', '1.1.0'],
        "chronicle.api/:#TokenInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#TokenResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#TokensResult": ['1.0.0', '1.1.0'],
        "chronicle.api/:#UserInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#VersionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Invite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Logout": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Purge": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Search": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Chunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Error": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Groups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Messages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Mutation": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Raw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Search": ['1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Session": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Status": ['1.0.0', '1.1.0'],
        "chronicle.api/[chronicle.api/:#Result]#Token": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Tokens": ['1.0.0', '1.1.0'],
        "chronicle.api/[chronicle.api/:#Result]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "chronicle.api/:#Chunk": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#ChunksResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#ClientEnvelope": { '1.1.0': 'identical' },
        "chronicle.api/:#Completion": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#ContentView": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Facet": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#FacetsResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Failure": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#GroupInfo": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#GroupsResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#IngestReceipt": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#IngestRequest": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#InviteInfo": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#JobInfo": { '1.1.0': 'identical', '1.2.0': 'prefix-compact', '1.3.0': 'prefix-compact' },
        "chronicle.api/:#JobState": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#LoginRequest": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#LoginResponse": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Message": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#MessagesResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Metadata": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#MutationReceipt": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Operation": { '1.1.0': 'identical' },
        "chronicle.api/:#RawFile": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#RawResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#RelatedResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Result": { '1.1.0': 'identical' },
        "chronicle.api/:#Scope": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchCountScope": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchFilter": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchHit": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchMode": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchQuery": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#ServerEnvelope": { '1.1.0': 'identical' },
        "chronicle.api/:#SessionInfo": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SessionResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SourceFormat": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SourceIdentity": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Span": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#StatusResult": { '1.1.0': 'identical', '1.2.0': 'json-additive', '1.3.0': 'json-additive' },
        "chronicle.api/:#TokenInfo": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#TokenResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#TokensResult": { '1.1.0': 'identical' },
        "chronicle.api/:#UserInfo": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#VersionInfo": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Facets": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Hello": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Invite": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Logout": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Ping": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Pong": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Purge": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Related": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Search": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Chunks": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Error": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Facets": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Groups": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Hello": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Messages": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Mutation": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Ping": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Pong": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Raw": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Related": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Search": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Session": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Status": { '1.1.0': 'identical', '1.2.0': 'json-additive', '1.3.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Token": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Tokens": { '1.1.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Whoami": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainChronicleApiV1_1_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainChronicleApiV1_1_0Meta.FORWARD[typeId] ?? {}; }
}

class DomainChronicleApiV1_2_0JsonCodecs extends AbstractBaboonJsonCodecs {
    constructor() {
        super();
        this.register(ChunkV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunkV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ChunksResultV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunksResultV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ClientEnvelopeV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ClientEnvelopeV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorCountersV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorCountersV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorPhaseV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorPhaseV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorProgressAckV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorProgressAckV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorProgressUpdateV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorProgressUpdateV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorStatusV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorStatusV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorStatusResultV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorStatusResultV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CompletionV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CompletionV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ContentViewV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ContentViewV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetsResultV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetsResultV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FailureV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FailureV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupInfoV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupInfoV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupsResultV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupsResultV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestReceiptV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestReceiptV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestRequestV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestRequestV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(InviteInfoV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => InviteInfoV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobInfoV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobInfoV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobStateV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobStateV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ListedTokenV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ListedTokenV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginRequestV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginRequestV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginResponseV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginResponseV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessageV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessagesResultV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessagesResultV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MetadataV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MetadataV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MutationReceiptV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MutationReceiptV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OperationV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OperationV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawFileV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawFileV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawResultV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawResultV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RelatedResultV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RelatedResultV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ResultV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ResultV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ScopeV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ScopeV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchCountScopeV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchCountScopeV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchFilterV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchFilterV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchHitV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchHitV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchModeV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchModeV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchQueryV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchQueryV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchResultV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchResultV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ServerEnvelopeV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ServerEnvelopeV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionInfoV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionInfoV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionResultV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionResultV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceFormatV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceFormatV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceIdentityV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceIdentityV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SpanV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SpanV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(StatusResultV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => StatusResultV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenInfoV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenInfoV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenResultV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenResultV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenSourceV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenSourceV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokensResultV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokensResultV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(UserInfoV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => UserInfoV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(VersionInfoV1_2_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => VersionInfoV1_2_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
    }
}

class DomainChronicleApiV1_2_0UebaCodecs extends AbstractBaboonUebaCodecs {
    constructor() {
        super();
        
    }
}

class DomainChronicleApiV1_2_0Conversions implements AbstractBaboonConversions {
    public versionsFrom(): string[] { return []; }
    public versionTo(): string { return '1.2.0'; }
}

class DomainChronicleApiV1_2_0Meta implements BaboonMeta {
    private static readonly SAME_IN: { readonly [typeId: string]: readonly string[] } = {
        "chronicle.api/:#Chunk": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ChunksResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ClientEnvelope": ['1.2.0'],
        "chronicle.api/:#CollectorCounters": ['1.2.0', '1.3.0'],
        "chronicle.api/:#CollectorPhase": ['1.2.0', '1.3.0'],
        "chronicle.api/:#CollectorProgressAck": ['1.2.0', '1.3.0'],
        "chronicle.api/:#CollectorProgressUpdate": ['1.2.0', '1.3.0'],
        "chronicle.api/:#CollectorStatus": ['1.2.0', '1.3.0'],
        "chronicle.api/:#CollectorStatusResult": ['1.2.0', '1.3.0'],
        "chronicle.api/:#Completion": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ContentView": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Facet": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#FacetsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Failure": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#GroupInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#GroupsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#IngestReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#IngestRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#InviteInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#JobInfo": ['1.2.0', '1.3.0'],
        "chronicle.api/:#JobState": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ListedToken": ['1.2.0', '1.3.0'],
        "chronicle.api/:#LoginRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#LoginResponse": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Message": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#MessagesResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Metadata": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#MutationReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Operation": ['1.2.0'],
        "chronicle.api/:#RawFile": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#RawResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#RelatedResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Result": ['1.2.0'],
        "chronicle.api/:#Scope": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchCountScope": ['1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchFilter": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchHit": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchMode": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchQuery": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchResult": ['1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ServerEnvelope": ['1.2.0'],
        "chronicle.api/:#SessionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SessionResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SourceFormat": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SourceIdentity": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Span": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#StatusResult": ['1.2.0', '1.3.0'],
        "chronicle.api/:#TokenInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#TokenResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#TokenSource": ['1.2.0', '1.3.0'],
        "chronicle.api/:#TokensResult": ['1.2.0', '1.3.0'],
        "chronicle.api/:#UserInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#VersionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": ['1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Invite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Logout": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Purge": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Search": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Chunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": ['1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Error": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Groups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Messages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Mutation": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Raw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Search": ['1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Session": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Status": ['1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Token": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Tokens": ['1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "chronicle.api/:#Chunk": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#ChunksResult": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#ClientEnvelope": { '1.2.0': 'identical' },
        "chronicle.api/:#CollectorCounters": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#CollectorPhase": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#CollectorProgressAck": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#CollectorProgressUpdate": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#CollectorStatus": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#CollectorStatusResult": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Completion": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#ContentView": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Facet": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#FacetsResult": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Failure": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#GroupInfo": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#GroupsResult": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#IngestReceipt": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#IngestRequest": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#InviteInfo": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#JobInfo": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#JobState": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#ListedToken": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#LoginRequest": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#LoginResponse": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Message": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#MessagesResult": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Metadata": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#MutationReceipt": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Operation": { '1.2.0': 'identical' },
        "chronicle.api/:#RawFile": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#RawResult": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#RelatedResult": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Result": { '1.2.0': 'identical' },
        "chronicle.api/:#Scope": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchCountScope": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchFilter": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchHit": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchMode": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchQuery": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SearchResult": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#ServerEnvelope": { '1.2.0': 'identical' },
        "chronicle.api/:#SessionInfo": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SessionResult": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SourceFormat": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#SourceIdentity": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#Span": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#StatusResult": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#TokenInfo": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#TokenResult": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#TokenSource": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#TokensResult": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#UserInfo": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/:#VersionInfo": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Facets": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Hello": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Invite": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Logout": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Ping": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Pong": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Purge": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Related": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Search": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Chunks": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Error": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Facets": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Groups": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Hello": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Messages": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Mutation": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Ping": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Pong": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Raw": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Related": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Search": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Session": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Status": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Token": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Tokens": { '1.2.0': 'identical', '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Whoami": { '1.2.0': 'identical', '1.3.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainChronicleApiV1_2_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainChronicleApiV1_2_0Meta.FORWARD[typeId] ?? {}; }
}

class DomainChronicleApiV1_3_0JsonCodecs extends AbstractBaboonJsonCodecs {
    constructor() {
        super();
        this.register(ActivityCollector_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityCollector_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJob_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJob_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobClass_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobClass_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobScope_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobScope_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobsQuery_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobsQuery_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobsResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobsResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityQuery_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityQuery_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveQuery_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveQuery_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveRow_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveRow_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveSort_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveSort_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveTextScope_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveTextScope_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Chunk_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Chunk_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ChunksResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunksResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ClientEnvelope_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ClientEnvelope_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorCounters_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorCounters_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorPhase_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorPhase_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorProgressAck_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorProgressAck_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorProgressUpdate_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorProgressUpdate_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorStatus_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorStatus_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorStatusResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorStatusResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Completion_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Completion_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ContentView_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ContentView_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Facet_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Facet_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetsResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetsResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Failure_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Failure_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupsResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupsResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestReceipt_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestReceipt_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(InviteInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => InviteInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobCounts_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobCounts_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobState_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobState_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ListedToken_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ListedToken_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginResponse_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginResponse_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Message_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Message_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessageLocation_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageLocation_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessagesResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessagesResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Metadata_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Metadata_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MutationReceipt_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MutationReceipt_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Operation_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Operation_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawFile_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawFile_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RelatedResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RelatedResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Result_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Result_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Scope_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Scope_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchCountScope_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchCountScope_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchFilter_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchFilter_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchHit_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchHit_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchMode_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchMode_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchQuery_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchQuery_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ServerEnvelope_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ServerEnvelope_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SortDirection_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SortDirection_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceFormat_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceFormat_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceIdentity_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceIdentity_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Span_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Span_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(StatusResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => StatusResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenSource_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenSource_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokensResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokensResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(UserInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => UserInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(VersionInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => VersionInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
    }
}

class DomainChronicleApiV1_3_0UebaCodecs extends AbstractBaboonUebaCodecs {
    constructor() {
        super();
        
    }
}

class DomainChronicleApiV1_3_0Conversions implements AbstractBaboonConversions {
    public versionsFrom(): string[] { return []; }
    public versionTo(): string { return '1.3.0'; }
}

class DomainChronicleApiV1_3_0Meta implements BaboonMeta {
    private static readonly SAME_IN: { readonly [typeId: string]: readonly string[] } = {
        "chronicle.api/:#ActivityCollector": ['1.3.0'],
        "chronicle.api/:#ActivityJob": ['1.3.0'],
        "chronicle.api/:#ActivityJobClass": ['1.3.0'],
        "chronicle.api/:#ActivityJobScope": ['1.3.0'],
        "chronicle.api/:#ActivityJobsQuery": ['1.3.0'],
        "chronicle.api/:#ActivityJobsResult": ['1.3.0'],
        "chronicle.api/:#ActivityQuery": ['1.3.0'],
        "chronicle.api/:#ActivityResult": ['1.3.0'],
        "chronicle.api/:#ArchiveQuery": ['1.3.0'],
        "chronicle.api/:#ArchiveResult": ['1.3.0'],
        "chronicle.api/:#ArchiveRow": ['1.3.0'],
        "chronicle.api/:#ArchiveSort": ['1.3.0'],
        "chronicle.api/:#ArchiveTextScope": ['1.3.0'],
        "chronicle.api/:#Chunk": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ChunksResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ClientEnvelope": ['1.3.0'],
        "chronicle.api/:#CollectorCounters": ['1.2.0', '1.3.0'],
        "chronicle.api/:#CollectorPhase": ['1.2.0', '1.3.0'],
        "chronicle.api/:#CollectorProgressAck": ['1.2.0', '1.3.0'],
        "chronicle.api/:#CollectorProgressUpdate": ['1.2.0', '1.3.0'],
        "chronicle.api/:#CollectorStatus": ['1.2.0', '1.3.0'],
        "chronicle.api/:#CollectorStatusResult": ['1.2.0', '1.3.0'],
        "chronicle.api/:#Completion": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ContentView": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Facet": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#FacetsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Failure": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#GroupInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#GroupsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#IngestReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#IngestRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#InviteInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#JobCounts": ['1.3.0'],
        "chronicle.api/:#JobInfo": ['1.2.0', '1.3.0'],
        "chronicle.api/:#JobState": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ListedToken": ['1.2.0', '1.3.0'],
        "chronicle.api/:#LoginRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#LoginResponse": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Message": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#MessageLocation": ['1.3.0'],
        "chronicle.api/:#MessagesResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Metadata": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#MutationReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Operation": ['1.3.0'],
        "chronicle.api/:#RawFile": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#RawResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#RelatedResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Result": ['1.3.0'],
        "chronicle.api/:#Scope": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchCountScope": ['1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchFilter": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchHit": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchMode": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchQuery": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SearchResult": ['1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#ServerEnvelope": ['1.3.0'],
        "chronicle.api/:#SessionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SessionResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SortDirection": ['1.3.0'],
        "chronicle.api/:#SourceFormat": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#SourceIdentity": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#Span": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#StatusResult": ['1.2.0', '1.3.0'],
        "chronicle.api/:#TokenInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#TokenResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#TokenSource": ['1.2.0', '1.3.0'],
        "chronicle.api/:#TokensResult": ['1.2.0', '1.3.0'],
        "chronicle.api/:#UserInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/:#VersionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Activity": ['1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs": ['1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Archive": ['1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": ['1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Invite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LocateMessage": ['1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Logout": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Purge": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Search": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Activity": ['1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#ActivityJobs": ['1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Archive": ['1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Chunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": ['1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Error": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Groups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#LocatedMessage": ['1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Messages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Mutation": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Raw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Search": ['1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Session": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Status": ['1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Token": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Tokens": ['1.2.0', '1.3.0'],
        "chronicle.api/[chronicle.api/:#Result]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "chronicle.api/:#ActivityCollector": { '1.3.0': 'identical' },
        "chronicle.api/:#ActivityJob": { '1.3.0': 'identical' },
        "chronicle.api/:#ActivityJobClass": { '1.3.0': 'identical' },
        "chronicle.api/:#ActivityJobScope": { '1.3.0': 'identical' },
        "chronicle.api/:#ActivityJobsQuery": { '1.3.0': 'identical' },
        "chronicle.api/:#ActivityJobsResult": { '1.3.0': 'identical' },
        "chronicle.api/:#ActivityQuery": { '1.3.0': 'identical' },
        "chronicle.api/:#ActivityResult": { '1.3.0': 'identical' },
        "chronicle.api/:#ArchiveQuery": { '1.3.0': 'identical' },
        "chronicle.api/:#ArchiveResult": { '1.3.0': 'identical' },
        "chronicle.api/:#ArchiveRow": { '1.3.0': 'identical' },
        "chronicle.api/:#ArchiveSort": { '1.3.0': 'identical' },
        "chronicle.api/:#ArchiveTextScope": { '1.3.0': 'identical' },
        "chronicle.api/:#Chunk": { '1.3.0': 'identical' },
        "chronicle.api/:#ChunksResult": { '1.3.0': 'identical' },
        "chronicle.api/:#ClientEnvelope": { '1.3.0': 'identical' },
        "chronicle.api/:#CollectorCounters": { '1.3.0': 'identical' },
        "chronicle.api/:#CollectorPhase": { '1.3.0': 'identical' },
        "chronicle.api/:#CollectorProgressAck": { '1.3.0': 'identical' },
        "chronicle.api/:#CollectorProgressUpdate": { '1.3.0': 'identical' },
        "chronicle.api/:#CollectorStatus": { '1.3.0': 'identical' },
        "chronicle.api/:#CollectorStatusResult": { '1.3.0': 'identical' },
        "chronicle.api/:#Completion": { '1.3.0': 'identical' },
        "chronicle.api/:#ContentView": { '1.3.0': 'identical' },
        "chronicle.api/:#Facet": { '1.3.0': 'identical' },
        "chronicle.api/:#FacetsResult": { '1.3.0': 'identical' },
        "chronicle.api/:#Failure": { '1.3.0': 'identical' },
        "chronicle.api/:#GroupInfo": { '1.3.0': 'identical' },
        "chronicle.api/:#GroupsResult": { '1.3.0': 'identical' },
        "chronicle.api/:#IngestReceipt": { '1.3.0': 'identical' },
        "chronicle.api/:#IngestRequest": { '1.3.0': 'identical' },
        "chronicle.api/:#InviteInfo": { '1.3.0': 'identical' },
        "chronicle.api/:#JobCounts": { '1.3.0': 'identical' },
        "chronicle.api/:#JobInfo": { '1.3.0': 'identical' },
        "chronicle.api/:#JobState": { '1.3.0': 'identical' },
        "chronicle.api/:#ListedToken": { '1.3.0': 'identical' },
        "chronicle.api/:#LoginRequest": { '1.3.0': 'identical' },
        "chronicle.api/:#LoginResponse": { '1.3.0': 'identical' },
        "chronicle.api/:#Message": { '1.3.0': 'identical' },
        "chronicle.api/:#MessageLocation": { '1.3.0': 'identical' },
        "chronicle.api/:#MessagesResult": { '1.3.0': 'identical' },
        "chronicle.api/:#Metadata": { '1.3.0': 'identical' },
        "chronicle.api/:#MutationReceipt": { '1.3.0': 'identical' },
        "chronicle.api/:#Operation": { '1.3.0': 'identical' },
        "chronicle.api/:#RawFile": { '1.3.0': 'identical' },
        "chronicle.api/:#RawResult": { '1.3.0': 'identical' },
        "chronicle.api/:#RelatedResult": { '1.3.0': 'identical' },
        "chronicle.api/:#Result": { '1.3.0': 'identical' },
        "chronicle.api/:#Scope": { '1.3.0': 'identical' },
        "chronicle.api/:#SearchCountScope": { '1.3.0': 'identical' },
        "chronicle.api/:#SearchFilter": { '1.3.0': 'identical' },
        "chronicle.api/:#SearchHit": { '1.3.0': 'identical' },
        "chronicle.api/:#SearchMode": { '1.3.0': 'identical' },
        "chronicle.api/:#SearchQuery": { '1.3.0': 'identical' },
        "chronicle.api/:#SearchResult": { '1.3.0': 'identical' },
        "chronicle.api/:#ServerEnvelope": { '1.3.0': 'identical' },
        "chronicle.api/:#SessionInfo": { '1.3.0': 'identical' },
        "chronicle.api/:#SessionResult": { '1.3.0': 'identical' },
        "chronicle.api/:#SortDirection": { '1.3.0': 'identical' },
        "chronicle.api/:#SourceFormat": { '1.3.0': 'identical' },
        "chronicle.api/:#SourceIdentity": { '1.3.0': 'identical' },
        "chronicle.api/:#Span": { '1.3.0': 'identical' },
        "chronicle.api/:#StatusResult": { '1.3.0': 'identical' },
        "chronicle.api/:#TokenInfo": { '1.3.0': 'identical' },
        "chronicle.api/:#TokenResult": { '1.3.0': 'identical' },
        "chronicle.api/:#TokenSource": { '1.3.0': 'identical' },
        "chronicle.api/:#TokensResult": { '1.3.0': 'identical' },
        "chronicle.api/:#UserInfo": { '1.3.0': 'identical' },
        "chronicle.api/:#VersionInfo": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Activity": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Archive": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Facets": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Hello": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Invite": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LocateMessage": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Logout": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Ping": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Pong": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Purge": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Related": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Search": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Activity": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ActivityJobs": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Archive": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Chunks": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Error": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Facets": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Groups": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Hello": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#LocatedMessage": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Messages": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Mutation": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Ping": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Pong": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Raw": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Related": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Search": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Session": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Status": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Token": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Tokens": { '1.3.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Whoami": { '1.3.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainChronicleApiV1_3_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainChronicleApiV1_3_0Meta.FORWARD[typeId] ?? {}; }
}

export class DomainChronicleApiFacade extends BaboonCodecsFacade {
    constructor() {
        super();
        this.register(
            new BaboonDomainVersion('chronicle.api', '1.0.0'),
            () => new DomainChronicleApiV1_0_0JsonCodecs(),
            () => new DomainChronicleApiV1_0_0UebaCodecs(),
            () => new DomainChronicleApiV1_0_0Conversions(),
            () => new DomainChronicleApiV1_0_0Meta(),
        );
        this.register(
            new BaboonDomainVersion('chronicle.api', '1.1.0'),
            () => new DomainChronicleApiV1_1_0JsonCodecs(),
            () => new DomainChronicleApiV1_1_0UebaCodecs(),
            () => new DomainChronicleApiV1_1_0Conversions(),
            () => new DomainChronicleApiV1_1_0Meta(),
        );
        this.register(
            new BaboonDomainVersion('chronicle.api', '1.2.0'),
            () => new DomainChronicleApiV1_2_0JsonCodecs(),
            () => new DomainChronicleApiV1_2_0UebaCodecs(),
            () => new DomainChronicleApiV1_2_0Conversions(),
            () => new DomainChronicleApiV1_2_0Meta(),
        );
        this.register(
            new BaboonDomainVersion('chronicle.api', '1.3.0'),
            () => new DomainChronicleApiV1_3_0JsonCodecs(),
            () => new DomainChronicleApiV1_3_0UebaCodecs(),
            () => new DomainChronicleApiV1_3_0Conversions(),
            () => new DomainChronicleApiV1_3_0Meta(),
        );
    }
}