

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
import { ActivityCollector as ActivityCollectorV1_3_0, ActivityCollector_JsonCodec as ActivityCollectorV1_3_0_JsonCodec } from './v1_3_0/ActivityCollector.js';
import { ActivityCollectorSort as ActivityCollectorSortV1_3_0, ActivityCollectorSort_JsonCodec as ActivityCollectorSortV1_3_0_JsonCodec } from './v1_3_0/ActivityCollectorSort.js';
import { ActivityJob as ActivityJobV1_3_0, ActivityJob_JsonCodec as ActivityJobV1_3_0_JsonCodec } from './v1_3_0/ActivityJob.js';
import { ActivityJobClass as ActivityJobClassV1_3_0, ActivityJobClass_JsonCodec as ActivityJobClassV1_3_0_JsonCodec } from './v1_3_0/ActivityJobClass.js';
import { ActivityJobScope as ActivityJobScopeV1_3_0, ActivityJobScope_JsonCodec as ActivityJobScopeV1_3_0_JsonCodec } from './v1_3_0/ActivityJobScope.js';
import { ActivityJobSort as ActivityJobSortV1_3_0, ActivityJobSort_JsonCodec as ActivityJobSortV1_3_0_JsonCodec } from './v1_3_0/ActivityJobSort.js';
import { ActivityJobsQuery as ActivityJobsQueryV1_3_0, ActivityJobsQuery_JsonCodec as ActivityJobsQueryV1_3_0_JsonCodec } from './v1_3_0/ActivityJobsQuery.js';
import { ActivityJobsResult as ActivityJobsResultV1_3_0, ActivityJobsResult_JsonCodec as ActivityJobsResultV1_3_0_JsonCodec } from './v1_3_0/ActivityJobsResult.js';
import { ActivityQuery as ActivityQueryV1_3_0, ActivityQuery_JsonCodec as ActivityQueryV1_3_0_JsonCodec } from './v1_3_0/ActivityQuery.js';
import { ActivityResult as ActivityResultV1_3_0, ActivityResult_JsonCodec as ActivityResultV1_3_0_JsonCodec } from './v1_3_0/ActivityResult.js';
import { ArchiveQuery as ArchiveQueryV1_3_0, ArchiveQuery_JsonCodec as ArchiveQueryV1_3_0_JsonCodec } from './v1_3_0/ArchiveQuery.js';
import { ArchiveResult as ArchiveResultV1_3_0, ArchiveResult_JsonCodec as ArchiveResultV1_3_0_JsonCodec } from './v1_3_0/ArchiveResult.js';
import { ArchiveRow as ArchiveRowV1_3_0, ArchiveRow_JsonCodec as ArchiveRowV1_3_0_JsonCodec } from './v1_3_0/ArchiveRow.js';
import { ArchiveSort as ArchiveSortV1_3_0, ArchiveSort_JsonCodec as ArchiveSortV1_3_0_JsonCodec } from './v1_3_0/ArchiveSort.js';
import { ArchiveTextScope as ArchiveTextScopeV1_3_0, ArchiveTextScope_JsonCodec as ArchiveTextScopeV1_3_0_JsonCodec } from './v1_3_0/ArchiveTextScope.js';
import { Chunk as ChunkV1_3_0, Chunk_JsonCodec as ChunkV1_3_0_JsonCodec } from './v1_3_0/Chunk.js';
import { ChunksResult as ChunksResultV1_3_0, ChunksResult_JsonCodec as ChunksResultV1_3_0_JsonCodec } from './v1_3_0/ChunksResult.js';
import { ClientEnvelope as ClientEnvelopeV1_3_0, ClientEnvelope_JsonCodec as ClientEnvelopeV1_3_0_JsonCodec } from './v1_3_0/ClientEnvelope.js';
import { CollectorCounters as CollectorCountersV1_3_0, CollectorCounters_JsonCodec as CollectorCountersV1_3_0_JsonCodec } from './v1_3_0/CollectorCounters.js';
import { CollectorPhase as CollectorPhaseV1_3_0, CollectorPhase_JsonCodec as CollectorPhaseV1_3_0_JsonCodec } from './v1_3_0/CollectorPhase.js';
import { CollectorProgressAck as CollectorProgressAckV1_3_0, CollectorProgressAck_JsonCodec as CollectorProgressAckV1_3_0_JsonCodec } from './v1_3_0/CollectorProgressAck.js';
import { CollectorProgressUpdate as CollectorProgressUpdateV1_3_0, CollectorProgressUpdate_JsonCodec as CollectorProgressUpdateV1_3_0_JsonCodec } from './v1_3_0/CollectorProgressUpdate.js';
import { CollectorStatus as CollectorStatusV1_3_0, CollectorStatus_JsonCodec as CollectorStatusV1_3_0_JsonCodec } from './v1_3_0/CollectorStatus.js';
import { CollectorStatusResult as CollectorStatusResultV1_3_0, CollectorStatusResult_JsonCodec as CollectorStatusResultV1_3_0_JsonCodec } from './v1_3_0/CollectorStatusResult.js';
import { Completion as CompletionV1_3_0, Completion_JsonCodec as CompletionV1_3_0_JsonCodec } from './v1_3_0/Completion.js';
import { ContentView as ContentViewV1_3_0, ContentView_JsonCodec as ContentViewV1_3_0_JsonCodec } from './v1_3_0/ContentView.js';
import { Facet as FacetV1_3_0, Facet_JsonCodec as FacetV1_3_0_JsonCodec } from './v1_3_0/Facet.js';
import { FacetsResult as FacetsResultV1_3_0, FacetsResult_JsonCodec as FacetsResultV1_3_0_JsonCodec } from './v1_3_0/FacetsResult.js';
import { Failure as FailureV1_3_0, Failure_JsonCodec as FailureV1_3_0_JsonCodec } from './v1_3_0/Failure.js';
import { GroupInfo as GroupInfoV1_3_0, GroupInfo_JsonCodec as GroupInfoV1_3_0_JsonCodec } from './v1_3_0/GroupInfo.js';
import { GroupsResult as GroupsResultV1_3_0, GroupsResult_JsonCodec as GroupsResultV1_3_0_JsonCodec } from './v1_3_0/GroupsResult.js';
import { IngestReceipt as IngestReceiptV1_3_0, IngestReceipt_JsonCodec as IngestReceiptV1_3_0_JsonCodec } from './v1_3_0/IngestReceipt.js';
import { IngestRequest as IngestRequestV1_3_0, IngestRequest_JsonCodec as IngestRequestV1_3_0_JsonCodec } from './v1_3_0/IngestRequest.js';
import { InviteInfo as InviteInfoV1_3_0, InviteInfo_JsonCodec as InviteInfoV1_3_0_JsonCodec } from './v1_3_0/InviteInfo.js';
import { JobCounts as JobCountsV1_3_0, JobCounts_JsonCodec as JobCountsV1_3_0_JsonCodec } from './v1_3_0/JobCounts.js';
import { JobInfo as JobInfoV1_3_0, JobInfo_JsonCodec as JobInfoV1_3_0_JsonCodec } from './v1_3_0/JobInfo.js';
import { JobState as JobStateV1_3_0, JobState_JsonCodec as JobStateV1_3_0_JsonCodec } from './v1_3_0/JobState.js';
import { ListedToken as ListedTokenV1_3_0, ListedToken_JsonCodec as ListedTokenV1_3_0_JsonCodec } from './v1_3_0/ListedToken.js';
import { LoginRequest as LoginRequestV1_3_0, LoginRequest_JsonCodec as LoginRequestV1_3_0_JsonCodec } from './v1_3_0/LoginRequest.js';
import { LoginResponse as LoginResponseV1_3_0, LoginResponse_JsonCodec as LoginResponseV1_3_0_JsonCodec } from './v1_3_0/LoginResponse.js';
import { Message as MessageV1_3_0, Message_JsonCodec as MessageV1_3_0_JsonCodec } from './v1_3_0/Message.js';
import { MessageLocation as MessageLocationV1_3_0, MessageLocation_JsonCodec as MessageLocationV1_3_0_JsonCodec } from './v1_3_0/MessageLocation.js';
import { MessagesResult as MessagesResultV1_3_0, MessagesResult_JsonCodec as MessagesResultV1_3_0_JsonCodec } from './v1_3_0/MessagesResult.js';
import { Metadata as MetadataV1_3_0, Metadata_JsonCodec as MetadataV1_3_0_JsonCodec } from './v1_3_0/Metadata.js';
import { MutationReceipt as MutationReceiptV1_3_0, MutationReceipt_JsonCodec as MutationReceiptV1_3_0_JsonCodec } from './v1_3_0/MutationReceipt.js';
import { Operation as OperationV1_3_0, Operation_JsonCodec as OperationV1_3_0_JsonCodec } from './v1_3_0/Operation.js';
import { RawFile as RawFileV1_3_0, RawFile_JsonCodec as RawFileV1_3_0_JsonCodec } from './v1_3_0/RawFile.js';
import { RawResult as RawResultV1_3_0, RawResult_JsonCodec as RawResultV1_3_0_JsonCodec } from './v1_3_0/RawResult.js';
import { RelatedResult as RelatedResultV1_3_0, RelatedResult_JsonCodec as RelatedResultV1_3_0_JsonCodec } from './v1_3_0/RelatedResult.js';
import { Result as ResultV1_3_0, Result_JsonCodec as ResultV1_3_0_JsonCodec } from './v1_3_0/Result.js';
import { RetryFailedCounts as RetryFailedCountsV1_3_0, RetryFailedCounts_JsonCodec as RetryFailedCountsV1_3_0_JsonCodec } from './v1_3_0/RetryFailedCounts.js';
import { RetryFailedPlan as RetryFailedPlanV1_3_0, RetryFailedPlan_JsonCodec as RetryFailedPlanV1_3_0_JsonCodec } from './v1_3_0/RetryFailedPlan.js';
import { RetryFailedResult as RetryFailedResultV1_3_0, RetryFailedResult_JsonCodec as RetryFailedResultV1_3_0_JsonCodec } from './v1_3_0/RetryFailedResult.js';
import { Scope as ScopeV1_3_0, Scope_JsonCodec as ScopeV1_3_0_JsonCodec } from './v1_3_0/Scope.js';
import { SearchCountScope as SearchCountScopeV1_3_0, SearchCountScope_JsonCodec as SearchCountScopeV1_3_0_JsonCodec } from './v1_3_0/SearchCountScope.js';
import { SearchFilter as SearchFilterV1_3_0, SearchFilter_JsonCodec as SearchFilterV1_3_0_JsonCodec } from './v1_3_0/SearchFilter.js';
import { SearchHit as SearchHitV1_3_0, SearchHit_JsonCodec as SearchHitV1_3_0_JsonCodec } from './v1_3_0/SearchHit.js';
import { SearchMode as SearchModeV1_3_0, SearchMode_JsonCodec as SearchModeV1_3_0_JsonCodec } from './v1_3_0/SearchMode.js';
import { SearchQuery as SearchQueryV1_3_0, SearchQuery_JsonCodec as SearchQueryV1_3_0_JsonCodec } from './v1_3_0/SearchQuery.js';
import { SearchResult as SearchResultV1_3_0, SearchResult_JsonCodec as SearchResultV1_3_0_JsonCodec } from './v1_3_0/SearchResult.js';
import { ServerEnvelope as ServerEnvelopeV1_3_0, ServerEnvelope_JsonCodec as ServerEnvelopeV1_3_0_JsonCodec } from './v1_3_0/ServerEnvelope.js';
import { SessionInfo as SessionInfoV1_3_0, SessionInfo_JsonCodec as SessionInfoV1_3_0_JsonCodec } from './v1_3_0/SessionInfo.js';
import { SessionResult as SessionResultV1_3_0, SessionResult_JsonCodec as SessionResultV1_3_0_JsonCodec } from './v1_3_0/SessionResult.js';
import { SortDirection as SortDirectionV1_3_0, SortDirection_JsonCodec as SortDirectionV1_3_0_JsonCodec } from './v1_3_0/SortDirection.js';
import { SourceFormat as SourceFormatV1_3_0, SourceFormat_JsonCodec as SourceFormatV1_3_0_JsonCodec } from './v1_3_0/SourceFormat.js';
import { SourceIdentity as SourceIdentityV1_3_0, SourceIdentity_JsonCodec as SourceIdentityV1_3_0_JsonCodec } from './v1_3_0/SourceIdentity.js';
import { Span as SpanV1_3_0, Span_JsonCodec as SpanV1_3_0_JsonCodec } from './v1_3_0/Span.js';
import { StatusResult as StatusResultV1_3_0, StatusResult_JsonCodec as StatusResultV1_3_0_JsonCodec } from './v1_3_0/StatusResult.js';
import { TokenInfo as TokenInfoV1_3_0, TokenInfo_JsonCodec as TokenInfoV1_3_0_JsonCodec } from './v1_3_0/TokenInfo.js';
import { TokenResult as TokenResultV1_3_0, TokenResult_JsonCodec as TokenResultV1_3_0_JsonCodec } from './v1_3_0/TokenResult.js';
import { TokenSource as TokenSourceV1_3_0, TokenSource_JsonCodec as TokenSourceV1_3_0_JsonCodec } from './v1_3_0/TokenSource.js';
import { TokensResult as TokensResultV1_3_0, TokensResult_JsonCodec as TokensResultV1_3_0_JsonCodec } from './v1_3_0/TokensResult.js';
import { UserInfo as UserInfoV1_3_0, UserInfo_JsonCodec as UserInfoV1_3_0_JsonCodec } from './v1_3_0/UserInfo.js';
import { VersionInfo as VersionInfoV1_3_0, VersionInfo_JsonCodec as VersionInfoV1_3_0_JsonCodec } from './v1_3_0/VersionInfo.js';
import { ActivityCollector as ActivityCollectorV1_4_0, ActivityCollector_JsonCodec as ActivityCollectorV1_4_0_JsonCodec } from './v1_4_0/ActivityCollector.js';
import { ActivityCollectorSort as ActivityCollectorSortV1_4_0, ActivityCollectorSort_JsonCodec as ActivityCollectorSortV1_4_0_JsonCodec } from './v1_4_0/ActivityCollectorSort.js';
import { ActivityJob as ActivityJobV1_4_0, ActivityJob_JsonCodec as ActivityJobV1_4_0_JsonCodec } from './v1_4_0/ActivityJob.js';
import { ActivityJobClass as ActivityJobClassV1_4_0, ActivityJobClass_JsonCodec as ActivityJobClassV1_4_0_JsonCodec } from './v1_4_0/ActivityJobClass.js';
import { ActivityJobScope as ActivityJobScopeV1_4_0, ActivityJobScope_JsonCodec as ActivityJobScopeV1_4_0_JsonCodec } from './v1_4_0/ActivityJobScope.js';
import { ActivityJobSort as ActivityJobSortV1_4_0, ActivityJobSort_JsonCodec as ActivityJobSortV1_4_0_JsonCodec } from './v1_4_0/ActivityJobSort.js';
import { ActivityJobsQuery as ActivityJobsQueryV1_4_0, ActivityJobsQuery_JsonCodec as ActivityJobsQueryV1_4_0_JsonCodec } from './v1_4_0/ActivityJobsQuery.js';
import { ActivityJobsResult as ActivityJobsResultV1_4_0, ActivityJobsResult_JsonCodec as ActivityJobsResultV1_4_0_JsonCodec } from './v1_4_0/ActivityJobsResult.js';
import { ActivityQuery as ActivityQueryV1_4_0, ActivityQuery_JsonCodec as ActivityQueryV1_4_0_JsonCodec } from './v1_4_0/ActivityQuery.js';
import { ActivityResult as ActivityResultV1_4_0, ActivityResult_JsonCodec as ActivityResultV1_4_0_JsonCodec } from './v1_4_0/ActivityResult.js';
import { ArchiveQuery as ArchiveQueryV1_4_0, ArchiveQuery_JsonCodec as ArchiveQueryV1_4_0_JsonCodec } from './v1_4_0/ArchiveQuery.js';
import { ArchiveResult as ArchiveResultV1_4_0, ArchiveResult_JsonCodec as ArchiveResultV1_4_0_JsonCodec } from './v1_4_0/ArchiveResult.js';
import { ArchiveRow as ArchiveRowV1_4_0, ArchiveRow_JsonCodec as ArchiveRowV1_4_0_JsonCodec } from './v1_4_0/ArchiveRow.js';
import { ArchiveSort as ArchiveSortV1_4_0, ArchiveSort_JsonCodec as ArchiveSortV1_4_0_JsonCodec } from './v1_4_0/ArchiveSort.js';
import { ArchiveTextScope as ArchiveTextScopeV1_4_0, ArchiveTextScope_JsonCodec as ArchiveTextScopeV1_4_0_JsonCodec } from './v1_4_0/ArchiveTextScope.js';
import { Chunk as ChunkV1_4_0, Chunk_JsonCodec as ChunkV1_4_0_JsonCodec } from './v1_4_0/Chunk.js';
import { ChunksResult as ChunksResultV1_4_0, ChunksResult_JsonCodec as ChunksResultV1_4_0_JsonCodec } from './v1_4_0/ChunksResult.js';
import { ClientEnvelope as ClientEnvelopeV1_4_0, ClientEnvelope_JsonCodec as ClientEnvelopeV1_4_0_JsonCodec } from './v1_4_0/ClientEnvelope.js';
import { CollectorCounters as CollectorCountersV1_4_0, CollectorCounters_JsonCodec as CollectorCountersV1_4_0_JsonCodec } from './v1_4_0/CollectorCounters.js';
import { CollectorPhase as CollectorPhaseV1_4_0, CollectorPhase_JsonCodec as CollectorPhaseV1_4_0_JsonCodec } from './v1_4_0/CollectorPhase.js';
import { CollectorProgressAck as CollectorProgressAckV1_4_0, CollectorProgressAck_JsonCodec as CollectorProgressAckV1_4_0_JsonCodec } from './v1_4_0/CollectorProgressAck.js';
import { CollectorProgressUpdate as CollectorProgressUpdateV1_4_0, CollectorProgressUpdate_JsonCodec as CollectorProgressUpdateV1_4_0_JsonCodec } from './v1_4_0/CollectorProgressUpdate.js';
import { CollectorStatus as CollectorStatusV1_4_0, CollectorStatus_JsonCodec as CollectorStatusV1_4_0_JsonCodec } from './v1_4_0/CollectorStatus.js';
import { CollectorStatusResult as CollectorStatusResultV1_4_0, CollectorStatusResult_JsonCodec as CollectorStatusResultV1_4_0_JsonCodec } from './v1_4_0/CollectorStatusResult.js';
import { Completion as CompletionV1_4_0, Completion_JsonCodec as CompletionV1_4_0_JsonCodec } from './v1_4_0/Completion.js';
import { ContentView as ContentViewV1_4_0, ContentView_JsonCodec as ContentViewV1_4_0_JsonCodec } from './v1_4_0/ContentView.js';
import { ExpressionHint as ExpressionHintV1_4_0, ExpressionHint_JsonCodec as ExpressionHintV1_4_0_JsonCodec } from './v1_4_0/ExpressionHint.js';
import { ExpressionHintKind as ExpressionHintKindV1_4_0, ExpressionHintKind_JsonCodec as ExpressionHintKindV1_4_0_JsonCodec } from './v1_4_0/ExpressionHintKind.js';
import { ExpressionHintQuery as ExpressionHintQueryV1_4_0, ExpressionHintQuery_JsonCodec as ExpressionHintQueryV1_4_0_JsonCodec } from './v1_4_0/ExpressionHintQuery.js';
import { ExpressionHintTarget as ExpressionHintTargetV1_4_0, ExpressionHintTarget_JsonCodec as ExpressionHintTargetV1_4_0_JsonCodec } from './v1_4_0/ExpressionHintTarget.js';
import { ExpressionHintsResult as ExpressionHintsResultV1_4_0, ExpressionHintsResult_JsonCodec as ExpressionHintsResultV1_4_0_JsonCodec } from './v1_4_0/ExpressionHintsResult.js';
import { Facet as FacetV1_4_0, Facet_JsonCodec as FacetV1_4_0_JsonCodec } from './v1_4_0/Facet.js';
import { FacetsResult as FacetsResultV1_4_0, FacetsResult_JsonCodec as FacetsResultV1_4_0_JsonCodec } from './v1_4_0/FacetsResult.js';
import { Failure as FailureV1_4_0, Failure_JsonCodec as FailureV1_4_0_JsonCodec } from './v1_4_0/Failure.js';
import { GroupInfo as GroupInfoV1_4_0, GroupInfo_JsonCodec as GroupInfoV1_4_0_JsonCodec } from './v1_4_0/GroupInfo.js';
import { GroupsResult as GroupsResultV1_4_0, GroupsResult_JsonCodec as GroupsResultV1_4_0_JsonCodec } from './v1_4_0/GroupsResult.js';
import { IndexingSettings as IndexingSettingsV1_4_0, IndexingSettings_JsonCodec as IndexingSettingsV1_4_0_JsonCodec } from './v1_4_0/IndexingSettings.js';
import { IngestReceipt as IngestReceiptV1_4_0, IngestReceipt_JsonCodec as IngestReceiptV1_4_0_JsonCodec } from './v1_4_0/IngestReceipt.js';
import { IngestRequest as IngestRequestV1_4_0, IngestRequest_JsonCodec as IngestRequestV1_4_0_JsonCodec } from './v1_4_0/IngestRequest.js';
import { InviteInfo as InviteInfoV1_4_0, InviteInfo_JsonCodec as InviteInfoV1_4_0_JsonCodec } from './v1_4_0/InviteInfo.js';
import { JobCounts as JobCountsV1_4_0, JobCounts_JsonCodec as JobCountsV1_4_0_JsonCodec } from './v1_4_0/JobCounts.js';
import { JobInfo as JobInfoV1_4_0, JobInfo_JsonCodec as JobInfoV1_4_0_JsonCodec } from './v1_4_0/JobInfo.js';
import { JobState as JobStateV1_4_0, JobState_JsonCodec as JobStateV1_4_0_JsonCodec } from './v1_4_0/JobState.js';
import { ListedToken as ListedTokenV1_4_0, ListedToken_JsonCodec as ListedTokenV1_4_0_JsonCodec } from './v1_4_0/ListedToken.js';
import { LoginRequest as LoginRequestV1_4_0, LoginRequest_JsonCodec as LoginRequestV1_4_0_JsonCodec } from './v1_4_0/LoginRequest.js';
import { LoginResponse as LoginResponseV1_4_0, LoginResponse_JsonCodec as LoginResponseV1_4_0_JsonCodec } from './v1_4_0/LoginResponse.js';
import { McpTestCatalog as McpTestCatalogV1_4_0, McpTestCatalog_JsonCodec as McpTestCatalogV1_4_0_JsonCodec } from './v1_4_0/McpTestCatalog.js';
import { McpTestEvent as McpTestEventV1_4_0, McpTestEvent_JsonCodec as McpTestEventV1_4_0_JsonCodec } from './v1_4_0/McpTestEvent.js';
import { McpTestItem as McpTestItemV1_4_0, McpTestItem_JsonCodec as McpTestItemV1_4_0_JsonCodec } from './v1_4_0/McpTestItem.js';
import { McpTestLimits as McpTestLimitsV1_4_0, McpTestLimits_JsonCodec as McpTestLimitsV1_4_0_JsonCodec } from './v1_4_0/McpTestLimits.js';
import { McpTestSnapshot as McpTestSnapshotV1_4_0, McpTestSnapshot_JsonCodec as McpTestSnapshotV1_4_0_JsonCodec } from './v1_4_0/McpTestSnapshot.js';
import { McpTestState as McpTestStateV1_4_0, McpTestState_JsonCodec as McpTestStateV1_4_0_JsonCodec } from './v1_4_0/McpTestState.js';
import { McpToolDefinition as McpToolDefinitionV1_4_0, McpToolDefinition_JsonCodec as McpToolDefinitionV1_4_0_JsonCodec } from './v1_4_0/McpToolDefinition.js';
import { Message as MessageV1_4_0, Message_JsonCodec as MessageV1_4_0_JsonCodec } from './v1_4_0/Message.js';
import { MessageLocation as MessageLocationV1_4_0, MessageLocation_JsonCodec as MessageLocationV1_4_0_JsonCodec } from './v1_4_0/MessageLocation.js';
import { MessagesResult as MessagesResultV1_4_0, MessagesResult_JsonCodec as MessagesResultV1_4_0_JsonCodec } from './v1_4_0/MessagesResult.js';
import { Metadata as MetadataV1_4_0, Metadata_JsonCodec as MetadataV1_4_0_JsonCodec } from './v1_4_0/Metadata.js';
import { ModelPurpose as ModelPurposeV1_4_0, ModelPurpose_JsonCodec as ModelPurposeV1_4_0_JsonCodec } from './v1_4_0/ModelPurpose.js';
import { ModelRateBasis as ModelRateBasisV1_4_0, ModelRateBasis_JsonCodec as ModelRateBasisV1_4_0_JsonCodec } from './v1_4_0/ModelRateBasis.js';
import { ModelUsageResult as ModelUsageResultV1_4_0, ModelUsageResult_JsonCodec as ModelUsageResultV1_4_0_JsonCodec } from './v1_4_0/ModelUsageResult.js';
import { ModelUsageSlice as ModelUsageSliceV1_4_0, ModelUsageSlice_JsonCodec as ModelUsageSliceV1_4_0_JsonCodec } from './v1_4_0/ModelUsageSlice.js';
import { MutationReceipt as MutationReceiptV1_4_0, MutationReceipt_JsonCodec as MutationReceiptV1_4_0_JsonCodec } from './v1_4_0/MutationReceipt.js';
import { Operation as OperationV1_4_0, Operation_JsonCodec as OperationV1_4_0_JsonCodec } from './v1_4_0/Operation.js';
import { OwnerReindexPlan as OwnerReindexPlanV1_4_0, OwnerReindexPlan_JsonCodec as OwnerReindexPlanV1_4_0_JsonCodec } from './v1_4_0/OwnerReindexPlan.js';
import { OwnerReindexResult as OwnerReindexResultV1_4_0, OwnerReindexResult_JsonCodec as OwnerReindexResultV1_4_0_JsonCodec } from './v1_4_0/OwnerReindexResult.js';
import { PassageFormat as PassageFormatV1_4_0, PassageFormat_JsonCodec as PassageFormatV1_4_0_JsonCodec } from './v1_4_0/PassageFormat.js';
import { PassageInfo as PassageInfoV1_4_0, PassageInfo_JsonCodec as PassageInfoV1_4_0_JsonCodec } from './v1_4_0/PassageInfo.js';
import { PassagePoint as PassagePointV1_4_0, PassagePoint_JsonCodec as PassagePointV1_4_0_JsonCodec } from './v1_4_0/PassagePoint.js';
import { PassageSourceSpan as PassageSourceSpanV1_4_0, PassageSourceSpan_JsonCodec as PassageSourceSpanV1_4_0_JsonCodec } from './v1_4_0/PassageSourceSpan.js';
import { PassageSpansResult as PassageSpansResultV1_4_0, PassageSpansResult_JsonCodec as PassageSpansResultV1_4_0_JsonCodec } from './v1_4_0/PassageSpansResult.js';
import { PassagesResult as PassagesResultV1_4_0, PassagesResult_JsonCodec as PassagesResultV1_4_0_JsonCodec } from './v1_4_0/PassagesResult.js';
import { RawFile as RawFileV1_4_0, RawFile_JsonCodec as RawFileV1_4_0_JsonCodec } from './v1_4_0/RawFile.js';
import { RawResult as RawResultV1_4_0, RawResult_JsonCodec as RawResultV1_4_0_JsonCodec } from './v1_4_0/RawResult.js';
import { RelatedResult as RelatedResultV1_4_0, RelatedResult_JsonCodec as RelatedResultV1_4_0_JsonCodec } from './v1_4_0/RelatedResult.js';
import { Result as ResultV1_4_0, Result_JsonCodec as ResultV1_4_0_JsonCodec } from './v1_4_0/Result.js';
import { RetryFailedCounts as RetryFailedCountsV1_4_0, RetryFailedCounts_JsonCodec as RetryFailedCountsV1_4_0_JsonCodec } from './v1_4_0/RetryFailedCounts.js';
import { RetryFailedPlan as RetryFailedPlanV1_4_0, RetryFailedPlan_JsonCodec as RetryFailedPlanV1_4_0_JsonCodec } from './v1_4_0/RetryFailedPlan.js';
import { RetryFailedResult as RetryFailedResultV1_4_0, RetryFailedResult_JsonCodec as RetryFailedResultV1_4_0_JsonCodec } from './v1_4_0/RetryFailedResult.js';
import { Scope as ScopeV1_4_0, Scope_JsonCodec as ScopeV1_4_0_JsonCodec } from './v1_4_0/Scope.js';
import { SearchCountScope as SearchCountScopeV1_4_0, SearchCountScope_JsonCodec as SearchCountScopeV1_4_0_JsonCodec } from './v1_4_0/SearchCountScope.js';
import { SearchFilter as SearchFilterV1_4_0, SearchFilter_JsonCodec as SearchFilterV1_4_0_JsonCodec } from './v1_4_0/SearchFilter.js';
import { SearchHit as SearchHitV1_4_0, SearchHit_JsonCodec as SearchHitV1_4_0_JsonCodec } from './v1_4_0/SearchHit.js';
import { SearchMode as SearchModeV1_4_0, SearchMode_JsonCodec as SearchModeV1_4_0_JsonCodec } from './v1_4_0/SearchMode.js';
import { SearchQuery as SearchQueryV1_4_0, SearchQuery_JsonCodec as SearchQueryV1_4_0_JsonCodec } from './v1_4_0/SearchQuery.js';
import { SearchResult as SearchResultV1_4_0, SearchResult_JsonCodec as SearchResultV1_4_0_JsonCodec } from './v1_4_0/SearchResult.js';
import { ServerEnvelope as ServerEnvelopeV1_4_0, ServerEnvelope_JsonCodec as ServerEnvelopeV1_4_0_JsonCodec } from './v1_4_0/ServerEnvelope.js';
import { SessionInfo as SessionInfoV1_4_0, SessionInfo_JsonCodec as SessionInfoV1_4_0_JsonCodec } from './v1_4_0/SessionInfo.js';
import { SessionResult as SessionResultV1_4_0, SessionResult_JsonCodec as SessionResultV1_4_0_JsonCodec } from './v1_4_0/SessionResult.js';
import { SortDirection as SortDirectionV1_4_0, SortDirection_JsonCodec as SortDirectionV1_4_0_JsonCodec } from './v1_4_0/SortDirection.js';
import { SourceFormat as SourceFormatV1_4_0, SourceFormat_JsonCodec as SourceFormatV1_4_0_JsonCodec } from './v1_4_0/SourceFormat.js';
import { SourceIdentity as SourceIdentityV1_4_0, SourceIdentity_JsonCodec as SourceIdentityV1_4_0_JsonCodec } from './v1_4_0/SourceIdentity.js';
import { Span as SpanV1_4_0, Span_JsonCodec as SpanV1_4_0_JsonCodec } from './v1_4_0/Span.js';
import { StatusResult as StatusResultV1_4_0, StatusResult_JsonCodec as StatusResultV1_4_0_JsonCodec } from './v1_4_0/StatusResult.js';
import { TokenInfo as TokenInfoV1_4_0, TokenInfo_JsonCodec as TokenInfoV1_4_0_JsonCodec } from './v1_4_0/TokenInfo.js';
import { TokenRateWindow as TokenRateWindowV1_4_0, TokenRateWindow_JsonCodec as TokenRateWindowV1_4_0_JsonCodec } from './v1_4_0/TokenRateWindow.js';
import { TokenResult as TokenResultV1_4_0, TokenResult_JsonCodec as TokenResultV1_4_0_JsonCodec } from './v1_4_0/TokenResult.js';
import { TokenSource as TokenSourceV1_4_0, TokenSource_JsonCodec as TokenSourceV1_4_0_JsonCodec } from './v1_4_0/TokenSource.js';
import { TokensResult as TokensResultV1_4_0, TokensResult_JsonCodec as TokensResultV1_4_0_JsonCodec } from './v1_4_0/TokensResult.js';
import { UserInfo as UserInfoV1_4_0, UserInfo_JsonCodec as UserInfoV1_4_0_JsonCodec } from './v1_4_0/UserInfo.js';
import { VersionInfo as VersionInfoV1_4_0, VersionInfo_JsonCodec as VersionInfoV1_4_0_JsonCodec } from './v1_4_0/VersionInfo.js';
import { ActivityCollector as ActivityCollectorV1_5_0, ActivityCollector_JsonCodec as ActivityCollectorV1_5_0_JsonCodec } from './v1_5_0/ActivityCollector.js';
import { ActivityCollectorSort as ActivityCollectorSortV1_5_0, ActivityCollectorSort_JsonCodec as ActivityCollectorSortV1_5_0_JsonCodec } from './v1_5_0/ActivityCollectorSort.js';
import { ActivityJob as ActivityJobV1_5_0, ActivityJob_JsonCodec as ActivityJobV1_5_0_JsonCodec } from './v1_5_0/ActivityJob.js';
import { ActivityJobClass as ActivityJobClassV1_5_0, ActivityJobClass_JsonCodec as ActivityJobClassV1_5_0_JsonCodec } from './v1_5_0/ActivityJobClass.js';
import { ActivityJobScope as ActivityJobScopeV1_5_0, ActivityJobScope_JsonCodec as ActivityJobScopeV1_5_0_JsonCodec } from './v1_5_0/ActivityJobScope.js';
import { ActivityJobSort as ActivityJobSortV1_5_0, ActivityJobSort_JsonCodec as ActivityJobSortV1_5_0_JsonCodec } from './v1_5_0/ActivityJobSort.js';
import { ActivityJobsQuery as ActivityJobsQueryV1_5_0, ActivityJobsQuery_JsonCodec as ActivityJobsQueryV1_5_0_JsonCodec } from './v1_5_0/ActivityJobsQuery.js';
import { ActivityJobsResult as ActivityJobsResultV1_5_0, ActivityJobsResult_JsonCodec as ActivityJobsResultV1_5_0_JsonCodec } from './v1_5_0/ActivityJobsResult.js';
import { ActivityQuery as ActivityQueryV1_5_0, ActivityQuery_JsonCodec as ActivityQueryV1_5_0_JsonCodec } from './v1_5_0/ActivityQuery.js';
import { ActivityResult as ActivityResultV1_5_0, ActivityResult_JsonCodec as ActivityResultV1_5_0_JsonCodec } from './v1_5_0/ActivityResult.js';
import { ArchiveQuery as ArchiveQueryV1_5_0, ArchiveQuery_JsonCodec as ArchiveQueryV1_5_0_JsonCodec } from './v1_5_0/ArchiveQuery.js';
import { ArchiveResult as ArchiveResultV1_5_0, ArchiveResult_JsonCodec as ArchiveResultV1_5_0_JsonCodec } from './v1_5_0/ArchiveResult.js';
import { ArchiveRow as ArchiveRowV1_5_0, ArchiveRow_JsonCodec as ArchiveRowV1_5_0_JsonCodec } from './v1_5_0/ArchiveRow.js';
import { ArchiveSort as ArchiveSortV1_5_0, ArchiveSort_JsonCodec as ArchiveSortV1_5_0_JsonCodec } from './v1_5_0/ArchiveSort.js';
import { ArchiveTextScope as ArchiveTextScopeV1_5_0, ArchiveTextScope_JsonCodec as ArchiveTextScopeV1_5_0_JsonCodec } from './v1_5_0/ArchiveTextScope.js';
import { Chunk as ChunkV1_5_0, Chunk_JsonCodec as ChunkV1_5_0_JsonCodec } from './v1_5_0/Chunk.js';
import { ChunksResult as ChunksResultV1_5_0, ChunksResult_JsonCodec as ChunksResultV1_5_0_JsonCodec } from './v1_5_0/ChunksResult.js';
import { ClientEnvelope as ClientEnvelopeV1_5_0, ClientEnvelope_JsonCodec as ClientEnvelopeV1_5_0_JsonCodec } from './v1_5_0/ClientEnvelope.js';
import { CollectorCounters as CollectorCountersV1_5_0, CollectorCounters_JsonCodec as CollectorCountersV1_5_0_JsonCodec } from './v1_5_0/CollectorCounters.js';
import { CollectorPhase as CollectorPhaseV1_5_0, CollectorPhase_JsonCodec as CollectorPhaseV1_5_0_JsonCodec } from './v1_5_0/CollectorPhase.js';
import { CollectorProgressAck as CollectorProgressAckV1_5_0, CollectorProgressAck_JsonCodec as CollectorProgressAckV1_5_0_JsonCodec } from './v1_5_0/CollectorProgressAck.js';
import { CollectorProgressUpdate as CollectorProgressUpdateV1_5_0, CollectorProgressUpdate_JsonCodec as CollectorProgressUpdateV1_5_0_JsonCodec } from './v1_5_0/CollectorProgressUpdate.js';
import { CollectorStatus as CollectorStatusV1_5_0, CollectorStatus_JsonCodec as CollectorStatusV1_5_0_JsonCodec } from './v1_5_0/CollectorStatus.js';
import { CollectorStatusResult as CollectorStatusResultV1_5_0, CollectorStatusResult_JsonCodec as CollectorStatusResultV1_5_0_JsonCodec } from './v1_5_0/CollectorStatusResult.js';
import { Completion as CompletionV1_5_0, Completion_JsonCodec as CompletionV1_5_0_JsonCodec } from './v1_5_0/Completion.js';
import { ContentView as ContentViewV1_5_0, ContentView_JsonCodec as ContentViewV1_5_0_JsonCodec } from './v1_5_0/ContentView.js';
import { ExpressionHint as ExpressionHintV1_5_0, ExpressionHint_JsonCodec as ExpressionHintV1_5_0_JsonCodec } from './v1_5_0/ExpressionHint.js';
import { ExpressionHintKind as ExpressionHintKindV1_5_0, ExpressionHintKind_JsonCodec as ExpressionHintKindV1_5_0_JsonCodec } from './v1_5_0/ExpressionHintKind.js';
import { ExpressionHintQuery as ExpressionHintQueryV1_5_0, ExpressionHintQuery_JsonCodec as ExpressionHintQueryV1_5_0_JsonCodec } from './v1_5_0/ExpressionHintQuery.js';
import { ExpressionHintTarget as ExpressionHintTargetV1_5_0, ExpressionHintTarget_JsonCodec as ExpressionHintTargetV1_5_0_JsonCodec } from './v1_5_0/ExpressionHintTarget.js';
import { ExpressionHintsResult as ExpressionHintsResultV1_5_0, ExpressionHintsResult_JsonCodec as ExpressionHintsResultV1_5_0_JsonCodec } from './v1_5_0/ExpressionHintsResult.js';
import { Facet as FacetV1_5_0, Facet_JsonCodec as FacetV1_5_0_JsonCodec } from './v1_5_0/Facet.js';
import { FacetsResult as FacetsResultV1_5_0, FacetsResult_JsonCodec as FacetsResultV1_5_0_JsonCodec } from './v1_5_0/FacetsResult.js';
import { Failure as FailureV1_5_0, Failure_JsonCodec as FailureV1_5_0_JsonCodec } from './v1_5_0/Failure.js';
import { GroupInfo as GroupInfoV1_5_0, GroupInfo_JsonCodec as GroupInfoV1_5_0_JsonCodec } from './v1_5_0/GroupInfo.js';
import { GroupsResult as GroupsResultV1_5_0, GroupsResult_JsonCodec as GroupsResultV1_5_0_JsonCodec } from './v1_5_0/GroupsResult.js';
import { IndexingSettings as IndexingSettingsV1_5_0, IndexingSettings_JsonCodec as IndexingSettingsV1_5_0_JsonCodec } from './v1_5_0/IndexingSettings.js';
import { IngestReceipt as IngestReceiptV1_5_0, IngestReceipt_JsonCodec as IngestReceiptV1_5_0_JsonCodec } from './v1_5_0/IngestReceipt.js';
import { IngestRequest as IngestRequestV1_5_0, IngestRequest_JsonCodec as IngestRequestV1_5_0_JsonCodec } from './v1_5_0/IngestRequest.js';
import { InviteInfo as InviteInfoV1_5_0, InviteInfo_JsonCodec as InviteInfoV1_5_0_JsonCodec } from './v1_5_0/InviteInfo.js';
import { JobCounts as JobCountsV1_5_0, JobCounts_JsonCodec as JobCountsV1_5_0_JsonCodec } from './v1_5_0/JobCounts.js';
import { JobInfo as JobInfoV1_5_0, JobInfo_JsonCodec as JobInfoV1_5_0_JsonCodec } from './v1_5_0/JobInfo.js';
import { JobState as JobStateV1_5_0, JobState_JsonCodec as JobStateV1_5_0_JsonCodec } from './v1_5_0/JobState.js';
import { ListedToken as ListedTokenV1_5_0, ListedToken_JsonCodec as ListedTokenV1_5_0_JsonCodec } from './v1_5_0/ListedToken.js';
import { LoginRequest as LoginRequestV1_5_0, LoginRequest_JsonCodec as LoginRequestV1_5_0_JsonCodec } from './v1_5_0/LoginRequest.js';
import { LoginResponse as LoginResponseV1_5_0, LoginResponse_JsonCodec as LoginResponseV1_5_0_JsonCodec } from './v1_5_0/LoginResponse.js';
import { McpTestCatalog as McpTestCatalogV1_5_0, McpTestCatalog_JsonCodec as McpTestCatalogV1_5_0_JsonCodec } from './v1_5_0/McpTestCatalog.js';
import { McpTestEvent as McpTestEventV1_5_0, McpTestEvent_JsonCodec as McpTestEventV1_5_0_JsonCodec } from './v1_5_0/McpTestEvent.js';
import { McpTestItem as McpTestItemV1_5_0, McpTestItem_JsonCodec as McpTestItemV1_5_0_JsonCodec } from './v1_5_0/McpTestItem.js';
import { McpTestLimits as McpTestLimitsV1_5_0, McpTestLimits_JsonCodec as McpTestLimitsV1_5_0_JsonCodec } from './v1_5_0/McpTestLimits.js';
import { McpTestSnapshot as McpTestSnapshotV1_5_0, McpTestSnapshot_JsonCodec as McpTestSnapshotV1_5_0_JsonCodec } from './v1_5_0/McpTestSnapshot.js';
import { McpTestState as McpTestStateV1_5_0, McpTestState_JsonCodec as McpTestStateV1_5_0_JsonCodec } from './v1_5_0/McpTestState.js';
import { McpToolDefinition as McpToolDefinitionV1_5_0, McpToolDefinition_JsonCodec as McpToolDefinitionV1_5_0_JsonCodec } from './v1_5_0/McpToolDefinition.js';
import { Message as MessageV1_5_0, Message_JsonCodec as MessageV1_5_0_JsonCodec } from './v1_5_0/Message.js';
import { MessageLocation as MessageLocationV1_5_0, MessageLocation_JsonCodec as MessageLocationV1_5_0_JsonCodec } from './v1_5_0/MessageLocation.js';
import { MessagesResult as MessagesResultV1_5_0, MessagesResult_JsonCodec as MessagesResultV1_5_0_JsonCodec } from './v1_5_0/MessagesResult.js';
import { Metadata as MetadataV1_5_0, Metadata_JsonCodec as MetadataV1_5_0_JsonCodec } from './v1_5_0/Metadata.js';
import { ModelPurpose as ModelPurposeV1_5_0, ModelPurpose_JsonCodec as ModelPurposeV1_5_0_JsonCodec } from './v1_5_0/ModelPurpose.js';
import { ModelRateBasis as ModelRateBasisV1_5_0, ModelRateBasis_JsonCodec as ModelRateBasisV1_5_0_JsonCodec } from './v1_5_0/ModelRateBasis.js';
import { ModelUsageResult as ModelUsageResultV1_5_0, ModelUsageResult_JsonCodec as ModelUsageResultV1_5_0_JsonCodec } from './v1_5_0/ModelUsageResult.js';
import { ModelUsageSlice as ModelUsageSliceV1_5_0, ModelUsageSlice_JsonCodec as ModelUsageSliceV1_5_0_JsonCodec } from './v1_5_0/ModelUsageSlice.js';
import { MutationReceipt as MutationReceiptV1_5_0, MutationReceipt_JsonCodec as MutationReceiptV1_5_0_JsonCodec } from './v1_5_0/MutationReceipt.js';
import { Operation as OperationV1_5_0, Operation_JsonCodec as OperationV1_5_0_JsonCodec } from './v1_5_0/Operation.js';
import { OwnerReindexPlan as OwnerReindexPlanV1_5_0, OwnerReindexPlan_JsonCodec as OwnerReindexPlanV1_5_0_JsonCodec } from './v1_5_0/OwnerReindexPlan.js';
import { OwnerReindexResult as OwnerReindexResultV1_5_0, OwnerReindexResult_JsonCodec as OwnerReindexResultV1_5_0_JsonCodec } from './v1_5_0/OwnerReindexResult.js';
import { PassageFormat as PassageFormatV1_5_0, PassageFormat_JsonCodec as PassageFormatV1_5_0_JsonCodec } from './v1_5_0/PassageFormat.js';
import { PassageInfo as PassageInfoV1_5_0, PassageInfo_JsonCodec as PassageInfoV1_5_0_JsonCodec } from './v1_5_0/PassageInfo.js';
import { PassagePoint as PassagePointV1_5_0, PassagePoint_JsonCodec as PassagePointV1_5_0_JsonCodec } from './v1_5_0/PassagePoint.js';
import { PassageSourceSpan as PassageSourceSpanV1_5_0, PassageSourceSpan_JsonCodec as PassageSourceSpanV1_5_0_JsonCodec } from './v1_5_0/PassageSourceSpan.js';
import { PassageSpansResult as PassageSpansResultV1_5_0, PassageSpansResult_JsonCodec as PassageSpansResultV1_5_0_JsonCodec } from './v1_5_0/PassageSpansResult.js';
import { PassagesResult as PassagesResultV1_5_0, PassagesResult_JsonCodec as PassagesResultV1_5_0_JsonCodec } from './v1_5_0/PassagesResult.js';
import { RawFile as RawFileV1_5_0, RawFile_JsonCodec as RawFileV1_5_0_JsonCodec } from './v1_5_0/RawFile.js';
import { RawResult as RawResultV1_5_0, RawResult_JsonCodec as RawResultV1_5_0_JsonCodec } from './v1_5_0/RawResult.js';
import { RelatedResult as RelatedResultV1_5_0, RelatedResult_JsonCodec as RelatedResultV1_5_0_JsonCodec } from './v1_5_0/RelatedResult.js';
import { Result as ResultV1_5_0, Result_JsonCodec as ResultV1_5_0_JsonCodec } from './v1_5_0/Result.js';
import { RetryFailedCounts as RetryFailedCountsV1_5_0, RetryFailedCounts_JsonCodec as RetryFailedCountsV1_5_0_JsonCodec } from './v1_5_0/RetryFailedCounts.js';
import { RetryFailedPlan as RetryFailedPlanV1_5_0, RetryFailedPlan_JsonCodec as RetryFailedPlanV1_5_0_JsonCodec } from './v1_5_0/RetryFailedPlan.js';
import { RetryFailedResult as RetryFailedResultV1_5_0, RetryFailedResult_JsonCodec as RetryFailedResultV1_5_0_JsonCodec } from './v1_5_0/RetryFailedResult.js';
import { Scope as ScopeV1_5_0, Scope_JsonCodec as ScopeV1_5_0_JsonCodec } from './v1_5_0/Scope.js';
import { SearchCountScope as SearchCountScopeV1_5_0, SearchCountScope_JsonCodec as SearchCountScopeV1_5_0_JsonCodec } from './v1_5_0/SearchCountScope.js';
import { SearchFilter as SearchFilterV1_5_0, SearchFilter_JsonCodec as SearchFilterV1_5_0_JsonCodec } from './v1_5_0/SearchFilter.js';
import { SearchHit as SearchHitV1_5_0, SearchHit_JsonCodec as SearchHitV1_5_0_JsonCodec } from './v1_5_0/SearchHit.js';
import { SearchMode as SearchModeV1_5_0, SearchMode_JsonCodec as SearchModeV1_5_0_JsonCodec } from './v1_5_0/SearchMode.js';
import { SearchQuery as SearchQueryV1_5_0, SearchQuery_JsonCodec as SearchQueryV1_5_0_JsonCodec } from './v1_5_0/SearchQuery.js';
import { SearchResult as SearchResultV1_5_0, SearchResult_JsonCodec as SearchResultV1_5_0_JsonCodec } from './v1_5_0/SearchResult.js';
import { ServerEnvelope as ServerEnvelopeV1_5_0, ServerEnvelope_JsonCodec as ServerEnvelopeV1_5_0_JsonCodec } from './v1_5_0/ServerEnvelope.js';
import { SessionInfo as SessionInfoV1_5_0, SessionInfo_JsonCodec as SessionInfoV1_5_0_JsonCodec } from './v1_5_0/SessionInfo.js';
import { SessionResult as SessionResultV1_5_0, SessionResult_JsonCodec as SessionResultV1_5_0_JsonCodec } from './v1_5_0/SessionResult.js';
import { SortDirection as SortDirectionV1_5_0, SortDirection_JsonCodec as SortDirectionV1_5_0_JsonCodec } from './v1_5_0/SortDirection.js';
import { SourceFormat as SourceFormatV1_5_0, SourceFormat_JsonCodec as SourceFormatV1_5_0_JsonCodec } from './v1_5_0/SourceFormat.js';
import { SourceIdentity as SourceIdentityV1_5_0, SourceIdentity_JsonCodec as SourceIdentityV1_5_0_JsonCodec } from './v1_5_0/SourceIdentity.js';
import { Span as SpanV1_5_0, Span_JsonCodec as SpanV1_5_0_JsonCodec } from './v1_5_0/Span.js';
import { StatusResult as StatusResultV1_5_0, StatusResult_JsonCodec as StatusResultV1_5_0_JsonCodec } from './v1_5_0/StatusResult.js';
import { TokenInfo as TokenInfoV1_5_0, TokenInfo_JsonCodec as TokenInfoV1_5_0_JsonCodec } from './v1_5_0/TokenInfo.js';
import { TokenRateWindow as TokenRateWindowV1_5_0, TokenRateWindow_JsonCodec as TokenRateWindowV1_5_0_JsonCodec } from './v1_5_0/TokenRateWindow.js';
import { TokenResult as TokenResultV1_5_0, TokenResult_JsonCodec as TokenResultV1_5_0_JsonCodec } from './v1_5_0/TokenResult.js';
import { TokenSource as TokenSourceV1_5_0, TokenSource_JsonCodec as TokenSourceV1_5_0_JsonCodec } from './v1_5_0/TokenSource.js';
import { TokensResult as TokensResultV1_5_0, TokensResult_JsonCodec as TokensResultV1_5_0_JsonCodec } from './v1_5_0/TokensResult.js';
import { UserInfo as UserInfoV1_5_0, UserInfo_JsonCodec as UserInfoV1_5_0_JsonCodec } from './v1_5_0/UserInfo.js';
import { VersionInfo as VersionInfoV1_5_0, VersionInfo_JsonCodec as VersionInfoV1_5_0_JsonCodec } from './v1_5_0/VersionInfo.js';
import { ActivityCollector as ActivityCollectorV1_6_0, ActivityCollector_JsonCodec as ActivityCollectorV1_6_0_JsonCodec } from './v1_6_0/ActivityCollector.js';
import { ActivityCollectorSort as ActivityCollectorSortV1_6_0, ActivityCollectorSort_JsonCodec as ActivityCollectorSortV1_6_0_JsonCodec } from './v1_6_0/ActivityCollectorSort.js';
import { ActivityJob as ActivityJobV1_6_0, ActivityJob_JsonCodec as ActivityJobV1_6_0_JsonCodec } from './v1_6_0/ActivityJob.js';
import { ActivityJobClass as ActivityJobClassV1_6_0, ActivityJobClass_JsonCodec as ActivityJobClassV1_6_0_JsonCodec } from './v1_6_0/ActivityJobClass.js';
import { ActivityJobScope as ActivityJobScopeV1_6_0, ActivityJobScope_JsonCodec as ActivityJobScopeV1_6_0_JsonCodec } from './v1_6_0/ActivityJobScope.js';
import { ActivityJobSort as ActivityJobSortV1_6_0, ActivityJobSort_JsonCodec as ActivityJobSortV1_6_0_JsonCodec } from './v1_6_0/ActivityJobSort.js';
import { ActivityJobsQuery as ActivityJobsQueryV1_6_0, ActivityJobsQuery_JsonCodec as ActivityJobsQueryV1_6_0_JsonCodec } from './v1_6_0/ActivityJobsQuery.js';
import { ActivityJobsResult as ActivityJobsResultV1_6_0, ActivityJobsResult_JsonCodec as ActivityJobsResultV1_6_0_JsonCodec } from './v1_6_0/ActivityJobsResult.js';
import { ActivityQuery as ActivityQueryV1_6_0, ActivityQuery_JsonCodec as ActivityQueryV1_6_0_JsonCodec } from './v1_6_0/ActivityQuery.js';
import { ActivityResult as ActivityResultV1_6_0, ActivityResult_JsonCodec as ActivityResultV1_6_0_JsonCodec } from './v1_6_0/ActivityResult.js';
import { ArchiveQuery as ArchiveQueryV1_6_0, ArchiveQuery_JsonCodec as ArchiveQueryV1_6_0_JsonCodec } from './v1_6_0/ArchiveQuery.js';
import { ArchiveResult as ArchiveResultV1_6_0, ArchiveResult_JsonCodec as ArchiveResultV1_6_0_JsonCodec } from './v1_6_0/ArchiveResult.js';
import { ArchiveRow as ArchiveRowV1_6_0, ArchiveRow_JsonCodec as ArchiveRowV1_6_0_JsonCodec } from './v1_6_0/ArchiveRow.js';
import { ArchiveSort as ArchiveSortV1_6_0, ArchiveSort_JsonCodec as ArchiveSortV1_6_0_JsonCodec } from './v1_6_0/ArchiveSort.js';
import { ArchiveTextScope as ArchiveTextScopeV1_6_0, ArchiveTextScope_JsonCodec as ArchiveTextScopeV1_6_0_JsonCodec } from './v1_6_0/ArchiveTextScope.js';
import { Chunk as ChunkV1_6_0, Chunk_JsonCodec as ChunkV1_6_0_JsonCodec } from './v1_6_0/Chunk.js';
import { ChunksResult as ChunksResultV1_6_0, ChunksResult_JsonCodec as ChunksResultV1_6_0_JsonCodec } from './v1_6_0/ChunksResult.js';
import { ClientEnvelope as ClientEnvelopeV1_6_0, ClientEnvelope_JsonCodec as ClientEnvelopeV1_6_0_JsonCodec } from './v1_6_0/ClientEnvelope.js';
import { CollectorCounters as CollectorCountersV1_6_0, CollectorCounters_JsonCodec as CollectorCountersV1_6_0_JsonCodec } from './v1_6_0/CollectorCounters.js';
import { CollectorPhase as CollectorPhaseV1_6_0, CollectorPhase_JsonCodec as CollectorPhaseV1_6_0_JsonCodec } from './v1_6_0/CollectorPhase.js';
import { CollectorProgressAck as CollectorProgressAckV1_6_0, CollectorProgressAck_JsonCodec as CollectorProgressAckV1_6_0_JsonCodec } from './v1_6_0/CollectorProgressAck.js';
import { CollectorProgressUpdate as CollectorProgressUpdateV1_6_0, CollectorProgressUpdate_JsonCodec as CollectorProgressUpdateV1_6_0_JsonCodec } from './v1_6_0/CollectorProgressUpdate.js';
import { CollectorStatus as CollectorStatusV1_6_0, CollectorStatus_JsonCodec as CollectorStatusV1_6_0_JsonCodec } from './v1_6_0/CollectorStatus.js';
import { CollectorStatusResult as CollectorStatusResultV1_6_0, CollectorStatusResult_JsonCodec as CollectorStatusResultV1_6_0_JsonCodec } from './v1_6_0/CollectorStatusResult.js';
import { Completion as CompletionV1_6_0, Completion_JsonCodec as CompletionV1_6_0_JsonCodec } from './v1_6_0/Completion.js';
import { ContentView as ContentViewV1_6_0, ContentView_JsonCodec as ContentViewV1_6_0_JsonCodec } from './v1_6_0/ContentView.js';
import { ExpressionHint as ExpressionHintV1_6_0, ExpressionHint_JsonCodec as ExpressionHintV1_6_0_JsonCodec } from './v1_6_0/ExpressionHint.js';
import { ExpressionHintKind as ExpressionHintKindV1_6_0, ExpressionHintKind_JsonCodec as ExpressionHintKindV1_6_0_JsonCodec } from './v1_6_0/ExpressionHintKind.js';
import { ExpressionHintQuery as ExpressionHintQueryV1_6_0, ExpressionHintQuery_JsonCodec as ExpressionHintQueryV1_6_0_JsonCodec } from './v1_6_0/ExpressionHintQuery.js';
import { ExpressionHintTarget as ExpressionHintTargetV1_6_0, ExpressionHintTarget_JsonCodec as ExpressionHintTargetV1_6_0_JsonCodec } from './v1_6_0/ExpressionHintTarget.js';
import { ExpressionHintsResult as ExpressionHintsResultV1_6_0, ExpressionHintsResult_JsonCodec as ExpressionHintsResultV1_6_0_JsonCodec } from './v1_6_0/ExpressionHintsResult.js';
import { Facet as FacetV1_6_0, Facet_JsonCodec as FacetV1_6_0_JsonCodec } from './v1_6_0/Facet.js';
import { FacetsResult as FacetsResultV1_6_0, FacetsResult_JsonCodec as FacetsResultV1_6_0_JsonCodec } from './v1_6_0/FacetsResult.js';
import { Failure as FailureV1_6_0, Failure_JsonCodec as FailureV1_6_0_JsonCodec } from './v1_6_0/Failure.js';
import { GroupInfo as GroupInfoV1_6_0, GroupInfo_JsonCodec as GroupInfoV1_6_0_JsonCodec } from './v1_6_0/GroupInfo.js';
import { GroupsResult as GroupsResultV1_6_0, GroupsResult_JsonCodec as GroupsResultV1_6_0_JsonCodec } from './v1_6_0/GroupsResult.js';
import { IndexingSettings as IndexingSettingsV1_6_0, IndexingSettings_JsonCodec as IndexingSettingsV1_6_0_JsonCodec } from './v1_6_0/IndexingSettings.js';
import { IngestReceipt as IngestReceiptV1_6_0, IngestReceipt_JsonCodec as IngestReceiptV1_6_0_JsonCodec } from './v1_6_0/IngestReceipt.js';
import { IngestRequest as IngestRequestV1_6_0, IngestRequest_JsonCodec as IngestRequestV1_6_0_JsonCodec } from './v1_6_0/IngestRequest.js';
import { InviteInfo as InviteInfoV1_6_0, InviteInfo_JsonCodec as InviteInfoV1_6_0_JsonCodec } from './v1_6_0/InviteInfo.js';
import { JobCounts as JobCountsV1_6_0, JobCounts_JsonCodec as JobCountsV1_6_0_JsonCodec } from './v1_6_0/JobCounts.js';
import { JobInfo as JobInfoV1_6_0, JobInfo_JsonCodec as JobInfoV1_6_0_JsonCodec } from './v1_6_0/JobInfo.js';
import { JobState as JobStateV1_6_0, JobState_JsonCodec as JobStateV1_6_0_JsonCodec } from './v1_6_0/JobState.js';
import { ListedToken as ListedTokenV1_6_0, ListedToken_JsonCodec as ListedTokenV1_6_0_JsonCodec } from './v1_6_0/ListedToken.js';
import { LoginRequest as LoginRequestV1_6_0, LoginRequest_JsonCodec as LoginRequestV1_6_0_JsonCodec } from './v1_6_0/LoginRequest.js';
import { LoginResponse as LoginResponseV1_6_0, LoginResponse_JsonCodec as LoginResponseV1_6_0_JsonCodec } from './v1_6_0/LoginResponse.js';
import { McpTestCatalog as McpTestCatalogV1_6_0, McpTestCatalog_JsonCodec as McpTestCatalogV1_6_0_JsonCodec } from './v1_6_0/McpTestCatalog.js';
import { McpTestEvent as McpTestEventV1_6_0, McpTestEvent_JsonCodec as McpTestEventV1_6_0_JsonCodec } from './v1_6_0/McpTestEvent.js';
import { McpTestItem as McpTestItemV1_6_0, McpTestItem_JsonCodec as McpTestItemV1_6_0_JsonCodec } from './v1_6_0/McpTestItem.js';
import { McpTestLimits as McpTestLimitsV1_6_0, McpTestLimits_JsonCodec as McpTestLimitsV1_6_0_JsonCodec } from './v1_6_0/McpTestLimits.js';
import { McpTestSnapshot as McpTestSnapshotV1_6_0, McpTestSnapshot_JsonCodec as McpTestSnapshotV1_6_0_JsonCodec } from './v1_6_0/McpTestSnapshot.js';
import { McpTestState as McpTestStateV1_6_0, McpTestState_JsonCodec as McpTestStateV1_6_0_JsonCodec } from './v1_6_0/McpTestState.js';
import { McpToolDefinition as McpToolDefinitionV1_6_0, McpToolDefinition_JsonCodec as McpToolDefinitionV1_6_0_JsonCodec } from './v1_6_0/McpToolDefinition.js';
import { Message as MessageV1_6_0, Message_JsonCodec as MessageV1_6_0_JsonCodec } from './v1_6_0/Message.js';
import { MessageLocation as MessageLocationV1_6_0, MessageLocation_JsonCodec as MessageLocationV1_6_0_JsonCodec } from './v1_6_0/MessageLocation.js';
import { MessageSearchHit as MessageSearchHitV1_6_0, MessageSearchHit_JsonCodec as MessageSearchHitV1_6_0_JsonCodec } from './v1_6_0/MessageSearchHit.js';
import { MessagesResult as MessagesResultV1_6_0, MessagesResult_JsonCodec as MessagesResultV1_6_0_JsonCodec } from './v1_6_0/MessagesResult.js';
import { Metadata as MetadataV1_6_0, Metadata_JsonCodec as MetadataV1_6_0_JsonCodec } from './v1_6_0/Metadata.js';
import { ModelPurpose as ModelPurposeV1_6_0, ModelPurpose_JsonCodec as ModelPurposeV1_6_0_JsonCodec } from './v1_6_0/ModelPurpose.js';
import { ModelRateBasis as ModelRateBasisV1_6_0, ModelRateBasis_JsonCodec as ModelRateBasisV1_6_0_JsonCodec } from './v1_6_0/ModelRateBasis.js';
import { ModelUsageResult as ModelUsageResultV1_6_0, ModelUsageResult_JsonCodec as ModelUsageResultV1_6_0_JsonCodec } from './v1_6_0/ModelUsageResult.js';
import { ModelUsageSlice as ModelUsageSliceV1_6_0, ModelUsageSlice_JsonCodec as ModelUsageSliceV1_6_0_JsonCodec } from './v1_6_0/ModelUsageSlice.js';
import { MutationReceipt as MutationReceiptV1_6_0, MutationReceipt_JsonCodec as MutationReceiptV1_6_0_JsonCodec } from './v1_6_0/MutationReceipt.js';
import { Operation as OperationV1_6_0, Operation_JsonCodec as OperationV1_6_0_JsonCodec } from './v1_6_0/Operation.js';
import { OwnerReindexPlan as OwnerReindexPlanV1_6_0, OwnerReindexPlan_JsonCodec as OwnerReindexPlanV1_6_0_JsonCodec } from './v1_6_0/OwnerReindexPlan.js';
import { OwnerReindexResult as OwnerReindexResultV1_6_0, OwnerReindexResult_JsonCodec as OwnerReindexResultV1_6_0_JsonCodec } from './v1_6_0/OwnerReindexResult.js';
import { PassageFormat as PassageFormatV1_6_0, PassageFormat_JsonCodec as PassageFormatV1_6_0_JsonCodec } from './v1_6_0/PassageFormat.js';
import { PassageInfo as PassageInfoV1_6_0, PassageInfo_JsonCodec as PassageInfoV1_6_0_JsonCodec } from './v1_6_0/PassageInfo.js';
import { PassagePoint as PassagePointV1_6_0, PassagePoint_JsonCodec as PassagePointV1_6_0_JsonCodec } from './v1_6_0/PassagePoint.js';
import { PassageSourceSpan as PassageSourceSpanV1_6_0, PassageSourceSpan_JsonCodec as PassageSourceSpanV1_6_0_JsonCodec } from './v1_6_0/PassageSourceSpan.js';
import { PassageSpansResult as PassageSpansResultV1_6_0, PassageSpansResult_JsonCodec as PassageSpansResultV1_6_0_JsonCodec } from './v1_6_0/PassageSpansResult.js';
import { PassagesResult as PassagesResultV1_6_0, PassagesResult_JsonCodec as PassagesResultV1_6_0_JsonCodec } from './v1_6_0/PassagesResult.js';
import { RawFile as RawFileV1_6_0, RawFile_JsonCodec as RawFileV1_6_0_JsonCodec } from './v1_6_0/RawFile.js';
import { RawResult as RawResultV1_6_0, RawResult_JsonCodec as RawResultV1_6_0_JsonCodec } from './v1_6_0/RawResult.js';
import { RelatedResult as RelatedResultV1_6_0, RelatedResult_JsonCodec as RelatedResultV1_6_0_JsonCodec } from './v1_6_0/RelatedResult.js';
import { Result as ResultV1_6_0, Result_JsonCodec as ResultV1_6_0_JsonCodec } from './v1_6_0/Result.js';
import { RetryFailedCounts as RetryFailedCountsV1_6_0, RetryFailedCounts_JsonCodec as RetryFailedCountsV1_6_0_JsonCodec } from './v1_6_0/RetryFailedCounts.js';
import { RetryFailedPlan as RetryFailedPlanV1_6_0, RetryFailedPlan_JsonCodec as RetryFailedPlanV1_6_0_JsonCodec } from './v1_6_0/RetryFailedPlan.js';
import { RetryFailedResult as RetryFailedResultV1_6_0, RetryFailedResult_JsonCodec as RetryFailedResultV1_6_0_JsonCodec } from './v1_6_0/RetryFailedResult.js';
import { Scope as ScopeV1_6_0, Scope_JsonCodec as ScopeV1_6_0_JsonCodec } from './v1_6_0/Scope.js';
import { SearchCountScope as SearchCountScopeV1_6_0, SearchCountScope_JsonCodec as SearchCountScopeV1_6_0_JsonCodec } from './v1_6_0/SearchCountScope.js';
import { SearchFilter as SearchFilterV1_6_0, SearchFilter_JsonCodec as SearchFilterV1_6_0_JsonCodec } from './v1_6_0/SearchFilter.js';
import { SearchHit as SearchHitV1_6_0, SearchHit_JsonCodec as SearchHitV1_6_0_JsonCodec } from './v1_6_0/SearchHit.js';
import { SearchMode as SearchModeV1_6_0, SearchMode_JsonCodec as SearchModeV1_6_0_JsonCodec } from './v1_6_0/SearchMode.js';
import { SearchQuery as SearchQueryV1_6_0, SearchQuery_JsonCodec as SearchQueryV1_6_0_JsonCodec } from './v1_6_0/SearchQuery.js';
import { SearchResult as SearchResultV1_6_0, SearchResult_JsonCodec as SearchResultV1_6_0_JsonCodec } from './v1_6_0/SearchResult.js';
import { ServerEnvelope as ServerEnvelopeV1_6_0, ServerEnvelope_JsonCodec as ServerEnvelopeV1_6_0_JsonCodec } from './v1_6_0/ServerEnvelope.js';
import { SessionInfo as SessionInfoV1_6_0, SessionInfo_JsonCodec as SessionInfoV1_6_0_JsonCodec } from './v1_6_0/SessionInfo.js';
import { SessionMessageSearchResult as SessionMessageSearchResultV1_6_0, SessionMessageSearchResult_JsonCodec as SessionMessageSearchResultV1_6_0_JsonCodec } from './v1_6_0/SessionMessageSearchResult.js';
import { SessionResult as SessionResultV1_6_0, SessionResult_JsonCodec as SessionResultV1_6_0_JsonCodec } from './v1_6_0/SessionResult.js';
import { SortDirection as SortDirectionV1_6_0, SortDirection_JsonCodec as SortDirectionV1_6_0_JsonCodec } from './v1_6_0/SortDirection.js';
import { SourceFormat as SourceFormatV1_6_0, SourceFormat_JsonCodec as SourceFormatV1_6_0_JsonCodec } from './v1_6_0/SourceFormat.js';
import { SourceIdentity as SourceIdentityV1_6_0, SourceIdentity_JsonCodec as SourceIdentityV1_6_0_JsonCodec } from './v1_6_0/SourceIdentity.js';
import { Span as SpanV1_6_0, Span_JsonCodec as SpanV1_6_0_JsonCodec } from './v1_6_0/Span.js';
import { StatusResult as StatusResultV1_6_0, StatusResult_JsonCodec as StatusResultV1_6_0_JsonCodec } from './v1_6_0/StatusResult.js';
import { TokenInfo as TokenInfoV1_6_0, TokenInfo_JsonCodec as TokenInfoV1_6_0_JsonCodec } from './v1_6_0/TokenInfo.js';
import { TokenRateWindow as TokenRateWindowV1_6_0, TokenRateWindow_JsonCodec as TokenRateWindowV1_6_0_JsonCodec } from './v1_6_0/TokenRateWindow.js';
import { TokenResult as TokenResultV1_6_0, TokenResult_JsonCodec as TokenResultV1_6_0_JsonCodec } from './v1_6_0/TokenResult.js';
import { TokenSource as TokenSourceV1_6_0, TokenSource_JsonCodec as TokenSourceV1_6_0_JsonCodec } from './v1_6_0/TokenSource.js';
import { TokensResult as TokensResultV1_6_0, TokensResult_JsonCodec as TokensResultV1_6_0_JsonCodec } from './v1_6_0/TokensResult.js';
import { UserInfo as UserInfoV1_6_0, UserInfo_JsonCodec as UserInfoV1_6_0_JsonCodec } from './v1_6_0/UserInfo.js';
import { VersionInfo as VersionInfoV1_6_0, VersionInfo_JsonCodec as VersionInfoV1_6_0_JsonCodec } from './v1_6_0/VersionInfo.js';
import { ActivityCollector, ActivityCollector_JsonCodec } from './ActivityCollector.js';
import { ActivityCollectorSort, ActivityCollectorSort_JsonCodec } from './ActivityCollectorSort.js';
import { ActivityJob, ActivityJob_JsonCodec } from './ActivityJob.js';
import { ActivityJobClass, ActivityJobClass_JsonCodec } from './ActivityJobClass.js';
import { ActivityJobScope, ActivityJobScope_JsonCodec } from './ActivityJobScope.js';
import { ActivityJobSort, ActivityJobSort_JsonCodec } from './ActivityJobSort.js';
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
import { ExpressionHint, ExpressionHint_JsonCodec } from './ExpressionHint.js';
import { ExpressionHintKind, ExpressionHintKind_JsonCodec } from './ExpressionHintKind.js';
import { ExpressionHintQuery, ExpressionHintQuery_JsonCodec } from './ExpressionHintQuery.js';
import { ExpressionHintTarget, ExpressionHintTarget_JsonCodec } from './ExpressionHintTarget.js';
import { ExpressionHintsResult, ExpressionHintsResult_JsonCodec } from './ExpressionHintsResult.js';
import { Facet, Facet_JsonCodec } from './Facet.js';
import { FacetsResult, FacetsResult_JsonCodec } from './FacetsResult.js';
import { Failure, Failure_JsonCodec } from './Failure.js';
import { GroupInfo, GroupInfo_JsonCodec } from './GroupInfo.js';
import { GroupsResult, GroupsResult_JsonCodec } from './GroupsResult.js';
import { IndexingFailureStage, IndexingFailureStage_JsonCodec } from './IndexingFailureStage.js';
import { IndexingSettings, IndexingSettings_JsonCodec } from './IndexingSettings.js';
import { IngestReceipt, IngestReceipt_JsonCodec } from './IngestReceipt.js';
import { IngestRequest, IngestRequest_JsonCodec } from './IngestRequest.js';
import { InviteInfo, InviteInfo_JsonCodec } from './InviteInfo.js';
import { JobCounts, JobCounts_JsonCodec } from './JobCounts.js';
import { JobInfo, JobInfo_JsonCodec } from './JobInfo.js';
import { JobState, JobState_JsonCodec } from './JobState.js';
import { ListedToken, ListedToken_JsonCodec } from './ListedToken.js';
import { LoginRequest, LoginRequest_JsonCodec } from './LoginRequest.js';
import { LoginResponse, LoginResponse_JsonCodec } from './LoginResponse.js';
import { McpTestCatalog, McpTestCatalog_JsonCodec } from './McpTestCatalog.js';
import { McpTestEvent, McpTestEvent_JsonCodec } from './McpTestEvent.js';
import { McpTestItem, McpTestItem_JsonCodec } from './McpTestItem.js';
import { McpTestLimits, McpTestLimits_JsonCodec } from './McpTestLimits.js';
import { McpTestSnapshot, McpTestSnapshot_JsonCodec } from './McpTestSnapshot.js';
import { McpTestState, McpTestState_JsonCodec } from './McpTestState.js';
import { McpToolDefinition, McpToolDefinition_JsonCodec } from './McpToolDefinition.js';
import { Message, Message_JsonCodec } from './Message.js';
import { MessageLocation, MessageLocation_JsonCodec } from './MessageLocation.js';
import { MessageSearchHit, MessageSearchHit_JsonCodec } from './MessageSearchHit.js';
import { MessagesResult, MessagesResult_JsonCodec } from './MessagesResult.js';
import { Metadata, Metadata_JsonCodec } from './Metadata.js';
import { ModelPurpose, ModelPurpose_JsonCodec } from './ModelPurpose.js';
import { ModelRateBasis, ModelRateBasis_JsonCodec } from './ModelRateBasis.js';
import { ModelUsageResult, ModelUsageResult_JsonCodec } from './ModelUsageResult.js';
import { ModelUsageSlice, ModelUsageSlice_JsonCodec } from './ModelUsageSlice.js';
import { MutationReceipt, MutationReceipt_JsonCodec } from './MutationReceipt.js';
import { Operation, Operation_JsonCodec } from './Operation.js';
import { OwnerReindexPlan, OwnerReindexPlan_JsonCodec } from './OwnerReindexPlan.js';
import { OwnerReindexResult, OwnerReindexResult_JsonCodec } from './OwnerReindexResult.js';
import { PassageFormat, PassageFormat_JsonCodec } from './PassageFormat.js';
import { PassageInfo, PassageInfo_JsonCodec } from './PassageInfo.js';
import { PassagePoint, PassagePoint_JsonCodec } from './PassagePoint.js';
import { PassageSourceSpan, PassageSourceSpan_JsonCodec } from './PassageSourceSpan.js';
import { PassageSpansResult, PassageSpansResult_JsonCodec } from './PassageSpansResult.js';
import { PassagesResult, PassagesResult_JsonCodec } from './PassagesResult.js';
import { RawFile, RawFile_JsonCodec } from './RawFile.js';
import { RawResult, RawResult_JsonCodec } from './RawResult.js';
import { ReindexStatusResult, ReindexStatusResult_JsonCodec } from './ReindexStatusResult.js';
import { RelatedResult, RelatedResult_JsonCodec } from './RelatedResult.js';
import { Result, Result_JsonCodec } from './Result.js';
import { RetryFailedCounts, RetryFailedCounts_JsonCodec } from './RetryFailedCounts.js';
import { RetryFailedPlan, RetryFailedPlan_JsonCodec } from './RetryFailedPlan.js';
import { RetryFailedResult, RetryFailedResult_JsonCodec } from './RetryFailedResult.js';
import { Scope, Scope_JsonCodec } from './Scope.js';
import { SearchCountScope, SearchCountScope_JsonCodec } from './SearchCountScope.js';
import { SearchFilter, SearchFilter_JsonCodec } from './SearchFilter.js';
import { SearchHit, SearchHit_JsonCodec } from './SearchHit.js';
import { SearchMode, SearchMode_JsonCodec } from './SearchMode.js';
import { SearchQuery, SearchQuery_JsonCodec } from './SearchQuery.js';
import { SearchResult, SearchResult_JsonCodec } from './SearchResult.js';
import { ServerEnvelope, ServerEnvelope_JsonCodec } from './ServerEnvelope.js';
import { SessionInfo, SessionInfo_JsonCodec } from './SessionInfo.js';
import { SessionMessageSearchResult, SessionMessageSearchResult_JsonCodec } from './SessionMessageSearchResult.js';
import { SessionResult, SessionResult_JsonCodec } from './SessionResult.js';
import { SortDirection, SortDirection_JsonCodec } from './SortDirection.js';
import { SourceFormat, SourceFormat_JsonCodec } from './SourceFormat.js';
import { SourceIdentity, SourceIdentity_JsonCodec } from './SourceIdentity.js';
import { Span, Span_JsonCodec } from './Span.js';
import { StatusResult, StatusResult_JsonCodec } from './StatusResult.js';
import { TokenInfo, TokenInfo_JsonCodec } from './TokenInfo.js';
import { TokenRateWindow, TokenRateWindow_JsonCodec } from './TokenRateWindow.js';
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
        "chronicle.api/:#Chunk": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ChunksResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ClientEnvelope": ['1.0.0', '1.1.0'],
        "chronicle.api/:#Completion": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ContentView": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Facet": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#FacetsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Failure": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#InviteInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#JobInfo": ['1.0.0', '1.1.0'],
        "chronicle.api/:#JobState": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginResponse": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Message": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MessagesResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Metadata": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MutationReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Operation": ['1.0.0', '1.1.0'],
        "chronicle.api/:#RawFile": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RawResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RelatedResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Result": ['1.0.0'],
        "chronicle.api/:#Scope": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchFilter": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchHit": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchMode": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchQuery": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchResult": ['1.0.0'],
        "chronicle.api/:#ServerEnvelope": ['1.0.0'],
        "chronicle.api/:#SessionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SessionResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceFormat": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceIdentity": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Span": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#StatusResult": ['1.0.0', '1.1.0'],
        "chronicle.api/:#TokenInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokensResult": ['1.0.0', '1.1.0'],
        "chronicle.api/:#UserInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#VersionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Invite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Logout": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Purge": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Search": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Chunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Error": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Groups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Messages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Mutation": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Raw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Search": ['1.0.0'],
        "chronicle.api/[chronicle.api/:#Result]#Session": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Status": ['1.0.0', '1.1.0'],
        "chronicle.api/[chronicle.api/:#Result]#Token": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Tokens": ['1.0.0', '1.1.0'],
        "chronicle.api/[chronicle.api/:#Result]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "chronicle.api/:#Chunk": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ChunksResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ClientEnvelope": { '1.0.0': 'identical', '1.1.0': 'identical' },
        "chronicle.api/:#Completion": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ContentView": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Facet": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#FacetsResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Failure": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#GroupInfo": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#GroupsResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IngestReceipt": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IngestRequest": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#InviteInfo": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#JobInfo": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'prefix-compact', '1.3.0': 'prefix-compact', '1.4.0': 'prefix-compact', '1.5.0': 'prefix-compact', '1.6.0': 'prefix-compact', '1.7.0': 'prefix-compact' },
        "chronicle.api/:#JobState": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#LoginRequest": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#LoginResponse": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Message": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MessagesResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Metadata": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MutationReceipt": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Operation": { '1.0.0': 'identical', '1.1.0': 'identical' },
        "chronicle.api/:#RawFile": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RawResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RelatedResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Result": { '1.0.0': 'identical', '1.1.0': 'json-additive' },
        "chronicle.api/:#Scope": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchFilter": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchHit": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchMode": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchQuery": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchResult": { '1.0.0': 'identical', '1.1.0': 'prefix-compact', '1.2.0': 'prefix-compact', '1.3.0': 'prefix-compact', '1.4.0': 'prefix-compact', '1.5.0': 'prefix-compact', '1.6.0': 'prefix-compact', '1.7.0': 'prefix-compact' },
        "chronicle.api/:#ServerEnvelope": { '1.0.0': 'identical', '1.1.0': 'json-additive' },
        "chronicle.api/:#SessionInfo": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SessionResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SourceFormat": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SourceIdentity": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Span": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#StatusResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'json-additive', '1.3.0': 'json-additive', '1.4.0': 'json-additive', '1.5.0': 'json-additive', '1.6.0': 'json-additive', '1.7.0': 'json-additive' },
        "chronicle.api/:#TokenInfo": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokenResult": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokensResult": { '1.0.0': 'identical', '1.1.0': 'identical' },
        "chronicle.api/:#UserInfo": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#VersionInfo": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Facets": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Hello": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Invite": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Logout": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Ping": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Pong": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Purge": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Related": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Search": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Chunks": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Error": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Facets": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Groups": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Hello": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Messages": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Mutation": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Ping": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Pong": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Raw": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Related": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Search": { '1.0.0': 'identical', '1.1.0': 'json-additive', '1.2.0': 'json-additive', '1.3.0': 'json-additive', '1.4.0': 'json-additive', '1.5.0': 'json-additive', '1.6.0': 'json-additive', '1.7.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Session": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Status": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'json-additive', '1.3.0': 'json-additive', '1.4.0': 'json-additive', '1.5.0': 'json-additive', '1.6.0': 'json-additive', '1.7.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Token": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Tokens": { '1.0.0': 'identical', '1.1.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Whoami": { '1.0.0': 'identical', '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
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
        "chronicle.api/:#Chunk": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ChunksResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ClientEnvelope": ['1.0.0', '1.1.0'],
        "chronicle.api/:#Completion": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ContentView": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Facet": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#FacetsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Failure": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#InviteInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#JobInfo": ['1.0.0', '1.1.0'],
        "chronicle.api/:#JobState": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginResponse": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Message": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MessagesResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Metadata": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MutationReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Operation": ['1.0.0', '1.1.0'],
        "chronicle.api/:#RawFile": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RawResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RelatedResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Result": ['1.1.0'],
        "chronicle.api/:#Scope": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchCountScope": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchFilter": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchHit": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchMode": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchQuery": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchResult": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ServerEnvelope": ['1.1.0'],
        "chronicle.api/:#SessionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SessionResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceFormat": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceIdentity": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Span": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#StatusResult": ['1.0.0', '1.1.0'],
        "chronicle.api/:#TokenInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokensResult": ['1.0.0', '1.1.0'],
        "chronicle.api/:#UserInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#VersionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Invite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Logout": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Purge": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Search": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Chunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Error": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Groups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Messages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Mutation": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Raw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Search": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Session": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Status": ['1.0.0', '1.1.0'],
        "chronicle.api/[chronicle.api/:#Result]#Token": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Tokens": ['1.0.0', '1.1.0'],
        "chronicle.api/[chronicle.api/:#Result]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "chronicle.api/:#Chunk": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ChunksResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ClientEnvelope": { '1.1.0': 'identical' },
        "chronicle.api/:#Completion": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ContentView": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Facet": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#FacetsResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Failure": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#GroupInfo": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#GroupsResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IngestReceipt": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IngestRequest": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#InviteInfo": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#JobInfo": { '1.1.0': 'identical', '1.2.0': 'prefix-compact', '1.3.0': 'prefix-compact', '1.4.0': 'prefix-compact', '1.5.0': 'prefix-compact', '1.6.0': 'prefix-compact', '1.7.0': 'prefix-compact' },
        "chronicle.api/:#JobState": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#LoginRequest": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#LoginResponse": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Message": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MessagesResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Metadata": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MutationReceipt": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Operation": { '1.1.0': 'identical' },
        "chronicle.api/:#RawFile": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RawResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RelatedResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Result": { '1.1.0': 'identical' },
        "chronicle.api/:#Scope": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchCountScope": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchFilter": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchHit": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchMode": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchQuery": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ServerEnvelope": { '1.1.0': 'identical' },
        "chronicle.api/:#SessionInfo": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SessionResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SourceFormat": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SourceIdentity": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Span": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#StatusResult": { '1.1.0': 'identical', '1.2.0': 'json-additive', '1.3.0': 'json-additive', '1.4.0': 'json-additive', '1.5.0': 'json-additive', '1.6.0': 'json-additive', '1.7.0': 'json-additive' },
        "chronicle.api/:#TokenInfo": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokenResult": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokensResult": { '1.1.0': 'identical' },
        "chronicle.api/:#UserInfo": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#VersionInfo": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Facets": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Hello": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Invite": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Logout": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Ping": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Pong": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Purge": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Related": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Search": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Chunks": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Error": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Facets": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Groups": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Hello": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Messages": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Mutation": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Ping": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Pong": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Raw": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Related": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Search": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Session": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Status": { '1.1.0': 'identical', '1.2.0': 'json-additive', '1.3.0': 'json-additive', '1.4.0': 'json-additive', '1.5.0': 'json-additive', '1.6.0': 'json-additive', '1.7.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Token": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Tokens": { '1.1.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Whoami": { '1.1.0': 'identical', '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
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
        "chronicle.api/:#Chunk": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ChunksResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ClientEnvelope": ['1.2.0'],
        "chronicle.api/:#CollectorCounters": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorPhase": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorProgressAck": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorProgressUpdate": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorStatusResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Completion": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ContentView": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Facet": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#FacetsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Failure": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#InviteInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#JobInfo": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#JobState": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ListedToken": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginResponse": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Message": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MessagesResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Metadata": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MutationReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Operation": ['1.2.0'],
        "chronicle.api/:#RawFile": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RawResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RelatedResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Result": ['1.2.0'],
        "chronicle.api/:#Scope": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchCountScope": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchFilter": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchHit": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchMode": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchQuery": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchResult": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ServerEnvelope": ['1.2.0'],
        "chronicle.api/:#SessionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SessionResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceFormat": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceIdentity": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Span": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#StatusResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#TokenInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenSource": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokensResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#UserInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#VersionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Invite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Logout": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Purge": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Search": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Chunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Error": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Groups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Messages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Mutation": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Raw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Search": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Session": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Status": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/[chronicle.api/:#Result]#Token": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Tokens": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "chronicle.api/:#Chunk": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ChunksResult": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ClientEnvelope": { '1.2.0': 'identical' },
        "chronicle.api/:#CollectorCounters": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorPhase": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorProgressAck": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorProgressUpdate": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorStatus": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorStatusResult": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Completion": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ContentView": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Facet": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#FacetsResult": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Failure": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#GroupInfo": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#GroupsResult": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IngestReceipt": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IngestRequest": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#InviteInfo": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#JobInfo": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'prefix-compact' },
        "chronicle.api/:#JobState": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ListedToken": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#LoginRequest": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#LoginResponse": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Message": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MessagesResult": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Metadata": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MutationReceipt": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Operation": { '1.2.0': 'identical' },
        "chronicle.api/:#RawFile": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RawResult": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RelatedResult": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Result": { '1.2.0': 'identical' },
        "chronicle.api/:#Scope": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchCountScope": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchFilter": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchHit": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchMode": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchQuery": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchResult": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ServerEnvelope": { '1.2.0': 'identical' },
        "chronicle.api/:#SessionInfo": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SessionResult": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SourceFormat": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SourceIdentity": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Span": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#StatusResult": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/:#TokenInfo": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokenResult": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokenSource": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokensResult": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#UserInfo": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#VersionInfo": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Facets": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Hello": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Invite": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Logout": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Ping": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Pong": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Purge": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Related": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Search": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Chunks": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Error": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Facets": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Groups": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Hello": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Messages": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Mutation": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Ping": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Pong": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Raw": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Related": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Search": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Session": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Status": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Token": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Tokens": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Whoami": { '1.2.0': 'identical', '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainChronicleApiV1_2_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainChronicleApiV1_2_0Meta.FORWARD[typeId] ?? {}; }
}

class DomainChronicleApiV1_3_0JsonCodecs extends AbstractBaboonJsonCodecs {
    constructor() {
        super();
        this.register(ActivityCollectorV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityCollectorV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityCollectorSortV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityCollectorSortV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobClassV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobClassV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobScopeV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobScopeV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobSortV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobSortV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobsQueryV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobsQueryV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobsResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobsResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityQueryV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityQueryV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveQueryV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveQueryV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveRowV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveRowV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveSortV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveSortV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveTextScopeV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveTextScopeV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ChunkV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunkV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ChunksResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunksResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ClientEnvelopeV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ClientEnvelopeV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorCountersV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorCountersV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorPhaseV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorPhaseV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorProgressAckV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorProgressAckV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorProgressUpdateV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorProgressUpdateV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorStatusV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorStatusV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorStatusResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorStatusResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CompletionV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CompletionV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ContentViewV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ContentViewV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetsResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetsResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FailureV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FailureV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupInfoV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupInfoV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupsResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupsResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestReceiptV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestReceiptV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestRequestV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestRequestV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(InviteInfoV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => InviteInfoV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobCountsV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobCountsV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobInfoV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobInfoV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobStateV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobStateV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ListedTokenV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ListedTokenV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginRequestV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginRequestV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginResponseV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginResponseV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessageV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessageLocationV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageLocationV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessagesResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessagesResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MetadataV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MetadataV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MutationReceiptV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MutationReceiptV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OperationV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OperationV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawFileV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawFileV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RelatedResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RelatedResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetryFailedCountsV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetryFailedCountsV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetryFailedPlanV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetryFailedPlanV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetryFailedResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetryFailedResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ScopeV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ScopeV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchCountScopeV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchCountScopeV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchFilterV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchFilterV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchHitV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchHitV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchModeV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchModeV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchQueryV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchQueryV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ServerEnvelopeV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ServerEnvelopeV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionInfoV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionInfoV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SortDirectionV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SortDirectionV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceFormatV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceFormatV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceIdentityV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceIdentityV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SpanV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SpanV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(StatusResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => StatusResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenInfoV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenInfoV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenSourceV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenSourceV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokensResultV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokensResultV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(UserInfoV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => UserInfoV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(VersionInfoV1_3_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => VersionInfoV1_3_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
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
        "chronicle.api/:#ActivityCollector": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityCollectorSort": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJob": ['1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#ActivityJobClass": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobScope": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobSort": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobsQuery": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobsResult": ['1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#ActivityQuery": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityResult": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ArchiveQuery": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ArchiveResult": ['1.3.0', '1.4.0'],
        "chronicle.api/:#ArchiveRow": ['1.3.0', '1.4.0'],
        "chronicle.api/:#ArchiveSort": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ArchiveTextScope": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Chunk": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ChunksResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ClientEnvelope": ['1.3.0'],
        "chronicle.api/:#CollectorCounters": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorPhase": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorProgressAck": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorProgressUpdate": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorStatusResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Completion": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ContentView": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Facet": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#FacetsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Failure": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#InviteInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#JobCounts": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#JobInfo": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#JobState": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ListedToken": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginResponse": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Message": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MessageLocation": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MessagesResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Metadata": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MutationReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Operation": ['1.3.0'],
        "chronicle.api/:#RawFile": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RawResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RelatedResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Result": ['1.3.0'],
        "chronicle.api/:#RetryFailedCounts": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RetryFailedPlan": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RetryFailedResult": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Scope": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchCountScope": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchFilter": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchHit": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchMode": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchQuery": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchResult": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ServerEnvelope": ['1.3.0'],
        "chronicle.api/:#SessionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SessionResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SortDirection": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceFormat": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceIdentity": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Span": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#StatusResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#TokenInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenSource": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokensResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#UserInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#VersionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Activity": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Archive": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Invite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LocateMessage": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Logout": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#PreviewRetryFailed": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Purge": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Search": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Activity": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#ActivityJobs": ['1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/[chronicle.api/:#Result]#Archive": ['1.3.0', '1.4.0'],
        "chronicle.api/[chronicle.api/:#Result]#Chunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Error": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Groups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#LocatedMessage": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Messages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Mutation": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Raw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#RetryFailed": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Search": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Session": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Status": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/[chronicle.api/:#Result]#Token": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Tokens": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "chronicle.api/:#ActivityCollector": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityCollectorSort": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJob": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/:#ActivityJobClass": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobScope": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobSort": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobsQuery": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobsResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/:#ActivityQuery": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveQuery": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'json-additive', '1.6.0': 'json-additive' },
        "chronicle.api/:#ArchiveRow": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'prefix-compact', '1.6.0': 'prefix-compact' },
        "chronicle.api/:#ArchiveSort": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveTextScope": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Chunk": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ChunksResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ClientEnvelope": { '1.3.0': 'identical' },
        "chronicle.api/:#CollectorCounters": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorPhase": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorProgressAck": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorProgressUpdate": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorStatus": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorStatusResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Completion": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ContentView": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Facet": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#FacetsResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Failure": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#GroupInfo": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#GroupsResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IngestReceipt": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IngestRequest": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#InviteInfo": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#JobCounts": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#JobInfo": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'prefix-compact' },
        "chronicle.api/:#JobState": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ListedToken": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#LoginRequest": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#LoginResponse": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Message": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MessageLocation": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MessagesResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Metadata": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MutationReceipt": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Operation": { '1.3.0': 'identical' },
        "chronicle.api/:#RawFile": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RawResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RelatedResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Result": { '1.3.0': 'identical' },
        "chronicle.api/:#RetryFailedCounts": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RetryFailedPlan": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RetryFailedResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Scope": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchCountScope": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchFilter": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchHit": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchMode": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchQuery": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ServerEnvelope": { '1.3.0': 'identical' },
        "chronicle.api/:#SessionInfo": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SessionResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SortDirection": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SourceFormat": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SourceIdentity": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Span": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#StatusResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/:#TokenInfo": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokenResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokenSource": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokensResult": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#UserInfo": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#VersionInfo": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Activity": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Archive": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Facets": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Hello": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Invite": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LocateMessage": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Logout": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Ping": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Pong": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#PreviewRetryFailed": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Purge": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Related": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Search": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Activity": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ActivityJobs": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Archive": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'json-additive', '1.6.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Chunks": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Error": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Facets": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Groups": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Hello": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#LocatedMessage": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Messages": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Mutation": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Ping": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Pong": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Raw": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Related": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#RetryFailed": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Search": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Session": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Status": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Token": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Tokens": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Whoami": { '1.3.0': 'identical', '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainChronicleApiV1_3_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainChronicleApiV1_3_0Meta.FORWARD[typeId] ?? {}; }
}

class DomainChronicleApiV1_4_0JsonCodecs extends AbstractBaboonJsonCodecs {
    constructor() {
        super();
        this.register(ActivityCollectorV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityCollectorV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityCollectorSortV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityCollectorSortV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobClassV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobClassV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobScopeV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobScopeV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobSortV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobSortV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobsQueryV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobsQueryV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobsResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobsResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityQueryV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityQueryV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveQueryV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveQueryV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveRowV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveRowV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveSortV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveSortV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveTextScopeV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveTextScopeV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ChunkV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunkV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ChunksResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunksResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ClientEnvelopeV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ClientEnvelopeV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorCountersV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorCountersV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorPhaseV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorPhaseV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorProgressAckV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorProgressAckV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorProgressUpdateV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorProgressUpdateV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorStatusV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorStatusV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorStatusResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorStatusResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CompletionV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CompletionV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ContentViewV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ContentViewV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintKindV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintKindV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintQueryV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintQueryV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintTargetV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintTargetV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintsResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintsResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetsResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetsResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FailureV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FailureV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupInfoV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupInfoV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupsResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupsResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IndexingSettingsV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IndexingSettingsV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestReceiptV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestReceiptV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestRequestV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestRequestV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(InviteInfoV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => InviteInfoV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobCountsV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobCountsV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobInfoV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobInfoV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobStateV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobStateV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ListedTokenV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ListedTokenV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginRequestV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginRequestV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginResponseV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginResponseV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestCatalogV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestCatalogV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestEventV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestEventV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestItemV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestItemV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestLimitsV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestLimitsV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestSnapshotV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestSnapshotV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestStateV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestStateV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpToolDefinitionV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpToolDefinitionV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessageV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessageLocationV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageLocationV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessagesResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessagesResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MetadataV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MetadataV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelPurposeV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelPurposeV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelRateBasisV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelRateBasisV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelUsageResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelUsageResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelUsageSliceV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelUsageSliceV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MutationReceiptV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MutationReceiptV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OperationV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OperationV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OwnerReindexPlanV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OwnerReindexPlanV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OwnerReindexResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OwnerReindexResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageFormatV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageFormatV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageInfoV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageInfoV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassagePointV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassagePointV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageSourceSpanV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageSourceSpanV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageSpansResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageSpansResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassagesResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassagesResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawFileV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawFileV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RelatedResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RelatedResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetryFailedCountsV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetryFailedCountsV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetryFailedPlanV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetryFailedPlanV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetryFailedResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetryFailedResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ScopeV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ScopeV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchCountScopeV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchCountScopeV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchFilterV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchFilterV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchHitV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchHitV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchModeV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchModeV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchQueryV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchQueryV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ServerEnvelopeV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ServerEnvelopeV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionInfoV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionInfoV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SortDirectionV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SortDirectionV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceFormatV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceFormatV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceIdentityV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceIdentityV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SpanV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SpanV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(StatusResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => StatusResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenInfoV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenInfoV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenRateWindowV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenRateWindowV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenSourceV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenSourceV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokensResultV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokensResultV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(UserInfoV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => UserInfoV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(VersionInfoV1_4_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => VersionInfoV1_4_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
    }
}

class DomainChronicleApiV1_4_0UebaCodecs extends AbstractBaboonUebaCodecs {
    constructor() {
        super();
        
    }
}

class DomainChronicleApiV1_4_0Conversions implements AbstractBaboonConversions {
    public versionsFrom(): string[] { return []; }
    public versionTo(): string { return '1.4.0'; }
}

class DomainChronicleApiV1_4_0Meta implements BaboonMeta {
    private static readonly SAME_IN: { readonly [typeId: string]: readonly string[] } = {
        "chronicle.api/:#ActivityCollector": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityCollectorSort": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJob": ['1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#ActivityJobClass": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobScope": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobSort": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobsQuery": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobsResult": ['1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#ActivityQuery": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityResult": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ArchiveQuery": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ArchiveResult": ['1.3.0', '1.4.0'],
        "chronicle.api/:#ArchiveRow": ['1.3.0', '1.4.0'],
        "chronicle.api/:#ArchiveSort": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ArchiveTextScope": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Chunk": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ChunksResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ClientEnvelope": ['1.4.0', '1.5.0'],
        "chronicle.api/:#CollectorCounters": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorPhase": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorProgressAck": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorProgressUpdate": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorStatusResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Completion": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ContentView": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHint": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintKind": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintQuery": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintTarget": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintsResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Facet": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#FacetsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Failure": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IndexingSettings": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#InviteInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#JobCounts": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#JobInfo": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#JobState": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ListedToken": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginResponse": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestCatalog": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestEvent": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestItem": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestLimits": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestSnapshot": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestState": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpToolDefinition": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Message": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MessageLocation": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MessagesResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Metadata": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelPurpose": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelRateBasis": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelUsageResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelUsageSlice": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MutationReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Operation": ['1.4.0', '1.5.0'],
        "chronicle.api/:#OwnerReindexPlan": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#OwnerReindexResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassageFormat": ['1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#PassageInfo": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassagePoint": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassageSourceSpan": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassageSpansResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassagesResult": ['1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#RawFile": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RawResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RelatedResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Result": ['1.4.0'],
        "chronicle.api/:#RetryFailedCounts": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RetryFailedPlan": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RetryFailedResult": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Scope": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchCountScope": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchFilter": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchHit": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchMode": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchQuery": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchResult": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ServerEnvelope": ['1.4.0'],
        "chronicle.api/:#SessionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SessionResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SortDirection": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceFormat": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceIdentity": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Span": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#StatusResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#TokenInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenRateWindow": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenSource": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokensResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#UserInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#VersionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityCollectors": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#Archive": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#McpTestItem]#Response": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolCall": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Activity": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ApplyOwnerReindex": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Archive": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CancelMcpTest": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ExpressionHints": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetPassageSpans": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetPassages": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Invite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LocateMessage": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Logout": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#McpTestTools": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ModelUsage": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#PreviewOwnerReindex": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#PreviewRetryFailed": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Purge": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ReadMcpTest": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Search": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#StartMcpTest": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Activity": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#ActivityJobs": ['1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/[chronicle.api/:#Result]#Archive": ['1.3.0', '1.4.0'],
        "chronicle.api/[chronicle.api/:#Result]#Chunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Error": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#ExpressionHints": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Groups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#LocatedMessage": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#McpTestRun": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#McpTestTools": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Messages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#ModelUsage": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Mutation": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexPreview": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexed": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#PassageSpans": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Passages": ['1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/[chronicle.api/:#Result]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Raw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#RetryFailed": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Search": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Session": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Status": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/[chronicle.api/:#Result]#Token": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Tokens": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "chronicle.api/:#ActivityCollector": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityCollectorSort": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJob": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/:#ActivityJobClass": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobScope": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobSort": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobsQuery": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobsResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/:#ActivityQuery": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveQuery": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveResult": { '1.4.0': 'identical', '1.5.0': 'json-additive', '1.6.0': 'json-additive' },
        "chronicle.api/:#ArchiveRow": { '1.4.0': 'identical', '1.5.0': 'prefix-compact', '1.6.0': 'prefix-compact' },
        "chronicle.api/:#ArchiveSort": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveTextScope": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Chunk": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ChunksResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ClientEnvelope": { '1.4.0': 'identical', '1.5.0': 'identical' },
        "chronicle.api/:#CollectorCounters": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorPhase": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorProgressAck": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorProgressUpdate": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorStatus": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorStatusResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Completion": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ContentView": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHint": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintKind": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintQuery": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintTarget": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintsResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Facet": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#FacetsResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Failure": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#GroupInfo": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#GroupsResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IndexingSettings": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IngestReceipt": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IngestRequest": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#InviteInfo": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#JobCounts": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#JobInfo": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'prefix-compact' },
        "chronicle.api/:#JobState": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ListedToken": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#LoginRequest": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#LoginResponse": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestCatalog": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestEvent": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestItem": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestLimits": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestSnapshot": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestState": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpToolDefinition": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Message": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MessageLocation": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MessagesResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Metadata": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ModelPurpose": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ModelRateBasis": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ModelUsageResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ModelUsageSlice": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MutationReceipt": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Operation": { '1.4.0': 'identical', '1.5.0': 'identical' },
        "chronicle.api/:#OwnerReindexPlan": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#OwnerReindexResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#PassageFormat": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical' },
        "chronicle.api/:#PassageInfo": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#PassagePoint": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#PassageSourceSpan": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#PassageSpansResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#PassagesResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical' },
        "chronicle.api/:#RawFile": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RawResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RelatedResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Result": { '1.4.0': 'identical', '1.5.0': 'json-additive' },
        "chronicle.api/:#RetryFailedCounts": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RetryFailedPlan": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RetryFailedResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Scope": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchCountScope": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchFilter": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchHit": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchMode": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchQuery": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ServerEnvelope": { '1.4.0': 'identical', '1.5.0': 'json-additive' },
        "chronicle.api/:#SessionInfo": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SessionResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SortDirection": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SourceFormat": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SourceIdentity": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Span": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#StatusResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/:#TokenInfo": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokenRateWindow": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokenResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokenSource": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokensResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#UserInfo": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#VersionInfo": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityCollectors": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#Archive": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#McpTestItem]#Response": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolCall": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolResult": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Activity": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ApplyOwnerReindex": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Archive": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CancelMcpTest": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ExpressionHints": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Facets": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetPassageSpans": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetPassages": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Hello": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Invite": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LocateMessage": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Logout": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#McpTestTools": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ModelUsage": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Ping": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Pong": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#PreviewOwnerReindex": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#PreviewRetryFailed": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Purge": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ReadMcpTest": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Related": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Search": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#StartMcpTest": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Activity": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ActivityJobs": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Archive": { '1.4.0': 'identical', '1.5.0': 'json-additive', '1.6.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Chunks": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Error": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ExpressionHints": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Facets": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Groups": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Hello": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#LocatedMessage": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#McpTestRun": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#McpTestTools": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Messages": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ModelUsage": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Mutation": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexPreview": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexed": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#PassageSpans": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Passages": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Ping": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Pong": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Raw": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Related": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#RetryFailed": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Search": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Session": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Status": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Token": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Tokens": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Whoami": { '1.4.0': 'identical', '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainChronicleApiV1_4_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainChronicleApiV1_4_0Meta.FORWARD[typeId] ?? {}; }
}

class DomainChronicleApiV1_5_0JsonCodecs extends AbstractBaboonJsonCodecs {
    constructor() {
        super();
        this.register(ActivityCollectorV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityCollectorV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityCollectorSortV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityCollectorSortV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobClassV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobClassV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobScopeV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobScopeV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobSortV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobSortV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobsQueryV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobsQueryV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobsResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobsResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityQueryV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityQueryV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveQueryV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveQueryV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveRowV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveRowV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveSortV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveSortV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveTextScopeV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveTextScopeV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ChunkV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunkV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ChunksResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunksResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ClientEnvelopeV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ClientEnvelopeV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorCountersV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorCountersV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorPhaseV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorPhaseV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorProgressAckV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorProgressAckV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorProgressUpdateV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorProgressUpdateV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorStatusV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorStatusV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorStatusResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorStatusResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CompletionV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CompletionV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ContentViewV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ContentViewV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintKindV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintKindV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintQueryV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintQueryV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintTargetV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintTargetV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintsResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintsResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetsResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetsResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FailureV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FailureV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupInfoV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupInfoV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupsResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupsResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IndexingSettingsV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IndexingSettingsV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestReceiptV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestReceiptV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestRequestV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestRequestV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(InviteInfoV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => InviteInfoV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobCountsV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobCountsV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobInfoV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobInfoV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobStateV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobStateV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ListedTokenV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ListedTokenV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginRequestV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginRequestV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginResponseV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginResponseV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestCatalogV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestCatalogV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestEventV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestEventV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestItemV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestItemV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestLimitsV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestLimitsV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestSnapshotV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestSnapshotV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestStateV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestStateV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpToolDefinitionV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpToolDefinitionV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessageV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessageLocationV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageLocationV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessagesResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessagesResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MetadataV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MetadataV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelPurposeV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelPurposeV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelRateBasisV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelRateBasisV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelUsageResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelUsageResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelUsageSliceV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelUsageSliceV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MutationReceiptV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MutationReceiptV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OperationV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OperationV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OwnerReindexPlanV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OwnerReindexPlanV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OwnerReindexResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OwnerReindexResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageFormatV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageFormatV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageInfoV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageInfoV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassagePointV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassagePointV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageSourceSpanV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageSourceSpanV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageSpansResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageSpansResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassagesResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassagesResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawFileV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawFileV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RelatedResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RelatedResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetryFailedCountsV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetryFailedCountsV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetryFailedPlanV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetryFailedPlanV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetryFailedResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetryFailedResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ScopeV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ScopeV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchCountScopeV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchCountScopeV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchFilterV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchFilterV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchHitV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchHitV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchModeV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchModeV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchQueryV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchQueryV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ServerEnvelopeV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ServerEnvelopeV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionInfoV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionInfoV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SortDirectionV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SortDirectionV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceFormatV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceFormatV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceIdentityV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceIdentityV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SpanV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SpanV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(StatusResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => StatusResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenInfoV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenInfoV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenRateWindowV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenRateWindowV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenSourceV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenSourceV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokensResultV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokensResultV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(UserInfoV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => UserInfoV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(VersionInfoV1_5_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => VersionInfoV1_5_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
    }
}

class DomainChronicleApiV1_5_0UebaCodecs extends AbstractBaboonUebaCodecs {
    constructor() {
        super();
        
    }
}

class DomainChronicleApiV1_5_0Conversions implements AbstractBaboonConversions {
    public versionsFrom(): string[] { return []; }
    public versionTo(): string { return '1.5.0'; }
}

class DomainChronicleApiV1_5_0Meta implements BaboonMeta {
    private static readonly SAME_IN: { readonly [typeId: string]: readonly string[] } = {
        "chronicle.api/:#ActivityCollector": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityCollectorSort": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJob": ['1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#ActivityJobClass": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobScope": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobSort": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobsQuery": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobsResult": ['1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#ActivityQuery": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityResult": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ArchiveQuery": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ArchiveResult": ['1.5.0', '1.6.0'],
        "chronicle.api/:#ArchiveRow": ['1.5.0', '1.6.0'],
        "chronicle.api/:#ArchiveSort": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ArchiveTextScope": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Chunk": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ChunksResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ClientEnvelope": ['1.4.0', '1.5.0'],
        "chronicle.api/:#CollectorCounters": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorPhase": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorProgressAck": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorProgressUpdate": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorStatusResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Completion": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ContentView": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHint": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintKind": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintQuery": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintTarget": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintsResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Facet": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#FacetsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Failure": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IndexingSettings": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#InviteInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#JobCounts": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#JobInfo": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#JobState": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ListedToken": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginResponse": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestCatalog": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestEvent": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestItem": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestLimits": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestSnapshot": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestState": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpToolDefinition": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Message": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MessageLocation": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MessagesResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Metadata": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelPurpose": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelRateBasis": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelUsageResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelUsageSlice": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MutationReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Operation": ['1.4.0', '1.5.0'],
        "chronicle.api/:#OwnerReindexPlan": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#OwnerReindexResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassageFormat": ['1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#PassageInfo": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassagePoint": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassageSourceSpan": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassageSpansResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassagesResult": ['1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#RawFile": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RawResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RelatedResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Result": ['1.5.0'],
        "chronicle.api/:#RetryFailedCounts": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RetryFailedPlan": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RetryFailedResult": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Scope": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchCountScope": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchFilter": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchHit": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchMode": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchQuery": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchResult": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ServerEnvelope": ['1.5.0'],
        "chronicle.api/:#SessionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SessionResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SortDirection": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceFormat": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceIdentity": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Span": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#StatusResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#TokenInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenRateWindow": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenSource": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokensResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#UserInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#VersionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityCollectors": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#Archive": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#McpTestItem]#Response": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolCall": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Activity": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ApplyOwnerReindex": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Archive": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CancelMcpTest": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ExpressionHints": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetPassageSpans": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetPassages": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Invite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LocateMessage": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Logout": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#McpTestTools": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ModelUsage": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#PreviewOwnerReindex": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#PreviewRetryFailed": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Purge": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ReadMcpTest": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Search": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#StartMcpTest": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Activity": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#ActivityJobs": ['1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/[chronicle.api/:#Result]#Archive": ['1.5.0', '1.6.0'],
        "chronicle.api/[chronicle.api/:#Result]#Chunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Error": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#ExpressionHints": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Groups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#LocatedMessage": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#McpTestRun": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#McpTestTools": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Messages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#ModelUsage": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Mutation": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexPreview": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexed": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#PassageSpans": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Passages": ['1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/[chronicle.api/:#Result]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Raw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#RetryFailed": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Search": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Session": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Status": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/[chronicle.api/:#Result]#Token": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Tokens": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "chronicle.api/:#ActivityCollector": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityCollectorSort": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJob": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/:#ActivityJobClass": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobScope": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobSort": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobsQuery": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobsResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/:#ActivityQuery": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveQuery": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveResult": { '1.5.0': 'identical', '1.6.0': 'identical' },
        "chronicle.api/:#ArchiveRow": { '1.5.0': 'identical', '1.6.0': 'identical' },
        "chronicle.api/:#ArchiveSort": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveTextScope": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Chunk": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ChunksResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ClientEnvelope": { '1.5.0': 'identical' },
        "chronicle.api/:#CollectorCounters": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorPhase": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorProgressAck": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorProgressUpdate": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorStatus": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorStatusResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Completion": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ContentView": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHint": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintKind": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintQuery": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintTarget": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintsResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Facet": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#FacetsResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Failure": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#GroupInfo": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#GroupsResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IndexingSettings": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IngestReceipt": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IngestRequest": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#InviteInfo": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#JobCounts": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#JobInfo": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'prefix-compact' },
        "chronicle.api/:#JobState": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ListedToken": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#LoginRequest": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#LoginResponse": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestCatalog": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestEvent": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestItem": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestLimits": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestSnapshot": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestState": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpToolDefinition": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Message": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MessageLocation": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MessagesResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Metadata": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ModelPurpose": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ModelRateBasis": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ModelUsageResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ModelUsageSlice": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MutationReceipt": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Operation": { '1.5.0': 'identical' },
        "chronicle.api/:#OwnerReindexPlan": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#OwnerReindexResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#PassageFormat": { '1.5.0': 'identical', '1.6.0': 'identical' },
        "chronicle.api/:#PassageInfo": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#PassagePoint": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#PassageSourceSpan": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#PassageSpansResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#PassagesResult": { '1.5.0': 'identical', '1.6.0': 'identical' },
        "chronicle.api/:#RawFile": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RawResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RelatedResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Result": { '1.5.0': 'identical' },
        "chronicle.api/:#RetryFailedCounts": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RetryFailedPlan": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RetryFailedResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Scope": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchCountScope": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchFilter": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchHit": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchMode": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchQuery": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ServerEnvelope": { '1.5.0': 'identical' },
        "chronicle.api/:#SessionInfo": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SessionResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SortDirection": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SourceFormat": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SourceIdentity": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Span": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#StatusResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/:#TokenInfo": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokenRateWindow": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokenResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokenSource": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokensResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#UserInfo": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#VersionInfo": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityCollectors": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#Archive": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#McpTestItem]#Response": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolCall": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolResult": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Activity": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ApplyOwnerReindex": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Archive": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CancelMcpTest": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ExpressionHints": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Facets": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetPassageSpans": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetPassages": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Hello": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Invite": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LocateMessage": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Logout": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#McpTestTools": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ModelUsage": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Ping": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Pong": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#PreviewOwnerReindex": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#PreviewRetryFailed": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Purge": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ReadMcpTest": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Related": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Search": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#StartMcpTest": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Activity": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ActivityJobs": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Archive": { '1.5.0': 'identical', '1.6.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Chunks": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Error": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ExpressionHints": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Facets": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Groups": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Hello": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#LocatedMessage": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#McpTestRun": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#McpTestTools": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Messages": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ModelUsage": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Mutation": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexPreview": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexed": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#PassageSpans": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Passages": { '1.5.0': 'identical', '1.6.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Ping": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Pong": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Raw": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Related": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#RetryFailed": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Search": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Session": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Status": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Token": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Tokens": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Whoami": { '1.5.0': 'identical', '1.6.0': 'identical', '1.7.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainChronicleApiV1_5_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainChronicleApiV1_5_0Meta.FORWARD[typeId] ?? {}; }
}

class DomainChronicleApiV1_6_0JsonCodecs extends AbstractBaboonJsonCodecs {
    constructor() {
        super();
        this.register(ActivityCollectorV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityCollectorV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityCollectorSortV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityCollectorSortV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobClassV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobClassV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobScopeV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobScopeV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobSortV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobSortV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobsQueryV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobsQueryV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobsResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobsResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityQueryV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityQueryV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveQueryV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveQueryV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveRowV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveRowV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveSortV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveSortV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveTextScopeV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveTextScopeV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ChunkV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunkV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ChunksResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ChunksResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ClientEnvelopeV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ClientEnvelopeV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorCountersV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorCountersV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorPhaseV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorPhaseV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorProgressAckV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorProgressAckV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorProgressUpdateV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorProgressUpdateV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorStatusV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorStatusV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CollectorStatusResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CollectorStatusResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CompletionV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CompletionV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ContentViewV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ContentViewV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintKindV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintKindV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintQueryV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintQueryV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintTargetV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintTargetV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintsResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintsResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetsResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetsResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FailureV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FailureV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupInfoV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupInfoV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupsResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupsResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IndexingSettingsV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IndexingSettingsV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestReceiptV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestReceiptV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestRequestV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestRequestV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(InviteInfoV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => InviteInfoV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobCountsV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobCountsV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobInfoV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobInfoV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobStateV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobStateV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ListedTokenV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ListedTokenV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginRequestV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginRequestV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginResponseV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginResponseV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestCatalogV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestCatalogV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestEventV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestEventV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestItemV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestItemV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestLimitsV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestLimitsV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestSnapshotV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestSnapshotV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestStateV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestStateV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpToolDefinitionV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpToolDefinitionV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessageV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessageLocationV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageLocationV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessageSearchHitV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageSearchHitV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessagesResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessagesResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MetadataV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MetadataV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelPurposeV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelPurposeV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelRateBasisV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelRateBasisV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelUsageResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelUsageResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelUsageSliceV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelUsageSliceV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MutationReceiptV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MutationReceiptV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OperationV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OperationV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OwnerReindexPlanV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OwnerReindexPlanV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OwnerReindexResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OwnerReindexResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageFormatV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageFormatV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageInfoV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageInfoV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassagePointV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassagePointV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageSourceSpanV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageSourceSpanV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageSpansResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageSpansResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassagesResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassagesResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawFileV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawFileV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RelatedResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RelatedResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetryFailedCountsV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetryFailedCountsV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetryFailedPlanV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetryFailedPlanV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetryFailedResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetryFailedResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ScopeV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ScopeV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchCountScopeV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchCountScopeV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchFilterV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchFilterV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchHitV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchHitV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchModeV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchModeV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchQueryV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchQueryV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ServerEnvelopeV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ServerEnvelopeV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionInfoV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionInfoV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionMessageSearchResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionMessageSearchResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SortDirectionV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SortDirectionV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceFormatV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceFormatV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceIdentityV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceIdentityV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SpanV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SpanV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(StatusResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => StatusResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenInfoV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenInfoV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenRateWindowV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenRateWindowV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenSourceV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenSourceV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokensResultV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokensResultV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(UserInfoV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => UserInfoV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(VersionInfoV1_6_0_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => VersionInfoV1_6_0_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
    }
}

class DomainChronicleApiV1_6_0UebaCodecs extends AbstractBaboonUebaCodecs {
    constructor() {
        super();
        
    }
}

class DomainChronicleApiV1_6_0Conversions implements AbstractBaboonConversions {
    public versionsFrom(): string[] { return []; }
    public versionTo(): string { return '1.6.0'; }
}

class DomainChronicleApiV1_6_0Meta implements BaboonMeta {
    private static readonly SAME_IN: { readonly [typeId: string]: readonly string[] } = {
        "chronicle.api/:#ActivityCollector": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityCollectorSort": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJob": ['1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#ActivityJobClass": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobScope": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobSort": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobsQuery": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobsResult": ['1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#ActivityQuery": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityResult": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ArchiveQuery": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ArchiveResult": ['1.5.0', '1.6.0'],
        "chronicle.api/:#ArchiveRow": ['1.5.0', '1.6.0'],
        "chronicle.api/:#ArchiveSort": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ArchiveTextScope": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Chunk": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ChunksResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ClientEnvelope": ['1.6.0'],
        "chronicle.api/:#CollectorCounters": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorPhase": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorProgressAck": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorProgressUpdate": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorStatusResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Completion": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ContentView": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHint": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintKind": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintQuery": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintTarget": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintsResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Facet": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#FacetsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Failure": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IndexingSettings": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#InviteInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#JobCounts": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#JobInfo": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#JobState": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ListedToken": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginResponse": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestCatalog": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestEvent": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestItem": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestLimits": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestSnapshot": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestState": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpToolDefinition": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Message": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MessageLocation": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MessageSearchHit": ['1.6.0', '1.7.0'],
        "chronicle.api/:#MessagesResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Metadata": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelPurpose": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelRateBasis": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelUsageResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelUsageSlice": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MutationReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Operation": ['1.6.0'],
        "chronicle.api/:#OwnerReindexPlan": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#OwnerReindexResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassageFormat": ['1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#PassageInfo": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassagePoint": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassageSourceSpan": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassageSpansResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassagesResult": ['1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#RawFile": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RawResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RelatedResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Result": ['1.6.0'],
        "chronicle.api/:#RetryFailedCounts": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RetryFailedPlan": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RetryFailedResult": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Scope": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchCountScope": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchFilter": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchHit": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchMode": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchQuery": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchResult": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ServerEnvelope": ['1.6.0'],
        "chronicle.api/:#SessionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SessionMessageSearchResult": ['1.6.0', '1.7.0'],
        "chronicle.api/:#SessionResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SortDirection": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceFormat": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceIdentity": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Span": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#StatusResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/:#TokenInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenRateWindow": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenSource": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokensResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#UserInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#VersionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityCollectors": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#Archive": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#McpTestItem]#Response": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolCall": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Activity": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ApplyOwnerReindex": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Archive": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CancelMcpTest": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ExpressionHints": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetPassageSpans": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetPassages": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Invite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LocateMessage": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Logout": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#McpTestTools": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ModelUsage": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#PreviewOwnerReindex": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#PreviewRetryFailed": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Purge": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ReadMcpTest": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Search": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#SearchSessionMessages": ['1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#StartMcpTest": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Activity": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#ActivityJobs": ['1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/[chronicle.api/:#Result]#Archive": ['1.5.0', '1.6.0'],
        "chronicle.api/[chronicle.api/:#Result]#Chunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Error": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#ExpressionHints": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Groups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#LocatedMessage": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#McpTestRun": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#McpTestTools": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Messages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#ModelUsage": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Mutation": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexPreview": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexed": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#PassageSpans": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Passages": ['1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/[chronicle.api/:#Result]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Raw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#RetryFailed": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Search": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Session": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#SessionMessageSearch": ['1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Status": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0'],
        "chronicle.api/[chronicle.api/:#Result]#Token": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Tokens": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "chronicle.api/:#ActivityCollector": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityCollectorSort": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJob": { '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/:#ActivityJobClass": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobScope": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobSort": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobsQuery": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobsResult": { '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/:#ActivityQuery": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ActivityResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveQuery": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveResult": { '1.6.0': 'identical' },
        "chronicle.api/:#ArchiveRow": { '1.6.0': 'identical' },
        "chronicle.api/:#ArchiveSort": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveTextScope": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Chunk": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ChunksResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ClientEnvelope": { '1.6.0': 'identical' },
        "chronicle.api/:#CollectorCounters": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorPhase": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorProgressAck": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorProgressUpdate": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorStatus": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#CollectorStatusResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Completion": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ContentView": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHint": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintKind": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintQuery": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintTarget": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintsResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Facet": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#FacetsResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Failure": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#GroupInfo": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#GroupsResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IndexingSettings": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IngestReceipt": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#IngestRequest": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#InviteInfo": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#JobCounts": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#JobInfo": { '1.6.0': 'identical', '1.7.0': 'prefix-compact' },
        "chronicle.api/:#JobState": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ListedToken": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#LoginRequest": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#LoginResponse": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestCatalog": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestEvent": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestItem": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestLimits": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestSnapshot": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpTestState": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#McpToolDefinition": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Message": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MessageLocation": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MessageSearchHit": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MessagesResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Metadata": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ModelPurpose": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ModelRateBasis": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ModelUsageResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ModelUsageSlice": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#MutationReceipt": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Operation": { '1.6.0': 'identical' },
        "chronicle.api/:#OwnerReindexPlan": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#OwnerReindexResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#PassageFormat": { '1.6.0': 'identical' },
        "chronicle.api/:#PassageInfo": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#PassagePoint": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#PassageSourceSpan": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#PassageSpansResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#PassagesResult": { '1.6.0': 'identical' },
        "chronicle.api/:#RawFile": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RawResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RelatedResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Result": { '1.6.0': 'identical' },
        "chronicle.api/:#RetryFailedCounts": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RetryFailedPlan": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#RetryFailedResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Scope": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchCountScope": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchFilter": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchHit": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchMode": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchQuery": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SearchResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#ServerEnvelope": { '1.6.0': 'identical' },
        "chronicle.api/:#SessionInfo": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SessionMessageSearchResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SessionResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SortDirection": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SourceFormat": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#SourceIdentity": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#Span": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#StatusResult": { '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/:#TokenInfo": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokenRateWindow": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokenResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokenSource": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#TokensResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#UserInfo": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/:#VersionInfo": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityCollectors": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#Archive": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#McpTestItem]#Response": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolCall": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolResult": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Activity": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ApplyOwnerReindex": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Archive": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CancelMcpTest": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ExpressionHints": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Facets": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetPassageSpans": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetPassages": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Hello": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Invite": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LocateMessage": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Logout": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#McpTestTools": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ModelUsage": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Ping": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Pong": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#PreviewOwnerReindex": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#PreviewRetryFailed": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Purge": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ReadMcpTest": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Related": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Search": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#SearchSessionMessages": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#StartMcpTest": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Activity": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ActivityJobs": { '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Archive": { '1.6.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Chunks": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Error": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ExpressionHints": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Facets": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Groups": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Hello": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#LocatedMessage": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#McpTestRun": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#McpTestTools": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Messages": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ModelUsage": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Mutation": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexPreview": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexed": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#PassageSpans": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Passages": { '1.6.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Ping": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Pong": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Raw": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Related": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#RetryFailed": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Search": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Session": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#SessionMessageSearch": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Status": { '1.6.0': 'identical', '1.7.0': 'json-additive' },
        "chronicle.api/[chronicle.api/:#Result]#Token": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Tokens": { '1.6.0': 'identical', '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Whoami": { '1.6.0': 'identical', '1.7.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainChronicleApiV1_6_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainChronicleApiV1_6_0Meta.FORWARD[typeId] ?? {}; }
}

class DomainChronicleApiV1_7_0JsonCodecs extends AbstractBaboonJsonCodecs {
    constructor() {
        super();
        this.register(ActivityCollector_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityCollector_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityCollectorSort_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityCollectorSort_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJob_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJob_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobClass_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobClass_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobScope_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobScope_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActivityJobSort_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActivityJobSort_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
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
        this.register(ExpressionHint_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHint_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintKind_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintKind_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintQuery_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintQuery_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintTarget_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintTarget_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ExpressionHintsResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ExpressionHintsResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Facet_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Facet_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FacetsResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FacetsResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Failure_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Failure_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GroupsResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GroupsResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IndexingFailureStage_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IndexingFailureStage_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IndexingSettings_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IndexingSettings_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestReceipt_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestReceipt_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(InviteInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => InviteInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobCounts_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobCounts_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JobState_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JobState_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ListedToken_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ListedToken_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginResponse_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginResponse_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestCatalog_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestCatalog_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestEvent_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestEvent_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestItem_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestItem_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestLimits_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestLimits_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestSnapshot_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestSnapshot_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpTestState_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpTestState_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(McpToolDefinition_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => McpToolDefinition_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Message_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Message_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessageLocation_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageLocation_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessageSearchHit_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageSearchHit_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MessagesResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessagesResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Metadata_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Metadata_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelPurpose_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelPurpose_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelRateBasis_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelRateBasis_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelUsageResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelUsageResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelUsageSlice_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelUsageSlice_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(MutationReceipt_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MutationReceipt_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Operation_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Operation_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OwnerReindexPlan_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OwnerReindexPlan_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OwnerReindexResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OwnerReindexResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageFormat_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageFormat_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassagePoint_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassagePoint_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageSourceSpan_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageSourceSpan_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassageSpansResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassageSpansResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PassagesResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PassagesResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawFile_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawFile_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RawResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RawResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ReindexStatusResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ReindexStatusResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RelatedResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RelatedResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Result_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Result_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetryFailedCounts_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetryFailedCounts_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetryFailedPlan_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetryFailedPlan_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetryFailedResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetryFailedResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Scope_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Scope_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchCountScope_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchCountScope_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchFilter_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchFilter_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchHit_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchHit_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchMode_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchMode_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchQuery_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchQuery_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ServerEnvelope_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ServerEnvelope_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionMessageSearchResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionMessageSearchResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SessionResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SessionResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SortDirection_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SortDirection_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceFormat_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceFormat_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceIdentity_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceIdentity_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Span_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Span_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(StatusResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => StatusResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenRateWindow_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenRateWindow_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokenSource_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokenSource_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(TokensResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => TokensResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(UserInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => UserInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(VersionInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => VersionInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
    }
}

class DomainChronicleApiV1_7_0UebaCodecs extends AbstractBaboonUebaCodecs {
    constructor() {
        super();
        
    }
}

class DomainChronicleApiV1_7_0Conversions implements AbstractBaboonConversions {
    public versionsFrom(): string[] { return []; }
    public versionTo(): string { return '1.7.0'; }
}

class DomainChronicleApiV1_7_0Meta implements BaboonMeta {
    private static readonly SAME_IN: { readonly [typeId: string]: readonly string[] } = {
        "chronicle.api/:#ActivityCollector": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityCollectorSort": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJob": ['1.7.0'],
        "chronicle.api/:#ActivityJobClass": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobScope": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobSort": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobsQuery": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityJobsResult": ['1.7.0'],
        "chronicle.api/:#ActivityQuery": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ActivityResult": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ArchiveQuery": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ArchiveResult": ['1.7.0'],
        "chronicle.api/:#ArchiveRow": ['1.7.0'],
        "chronicle.api/:#ArchiveSort": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ArchiveTextScope": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Chunk": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ChunksResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ClientEnvelope": ['1.7.0'],
        "chronicle.api/:#CollectorCounters": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorPhase": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorProgressAck": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorProgressUpdate": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#CollectorStatusResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Completion": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ContentView": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHint": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintKind": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintQuery": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintTarget": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ExpressionHintsResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Facet": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#FacetsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Failure": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#GroupsResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IndexingFailureStage": ['1.7.0'],
        "chronicle.api/:#IndexingSettings": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#IngestRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#InviteInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#JobCounts": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#JobInfo": ['1.7.0'],
        "chronicle.api/:#JobState": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ListedToken": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginRequest": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#LoginResponse": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestCatalog": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestEvent": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestItem": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestLimits": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestSnapshot": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpTestState": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#McpToolDefinition": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Message": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MessageLocation": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MessageSearchHit": ['1.6.0', '1.7.0'],
        "chronicle.api/:#MessagesResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Metadata": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelPurpose": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelRateBasis": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelUsageResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ModelUsageSlice": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#MutationReceipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Operation": ['1.7.0'],
        "chronicle.api/:#OwnerReindexPlan": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#OwnerReindexResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassageFormat": ['1.7.0'],
        "chronicle.api/:#PassageInfo": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassagePoint": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassageSourceSpan": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassageSpansResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#PassagesResult": ['1.7.0'],
        "chronicle.api/:#RawFile": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RawResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ReindexStatusResult": ['1.7.0'],
        "chronicle.api/:#RelatedResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Result": ['1.7.0'],
        "chronicle.api/:#RetryFailedCounts": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RetryFailedPlan": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#RetryFailedResult": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Scope": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchCountScope": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchFilter": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchHit": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchMode": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchQuery": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SearchResult": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#ServerEnvelope": ['1.7.0'],
        "chronicle.api/:#SessionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SessionMessageSearchResult": ['1.6.0', '1.7.0'],
        "chronicle.api/:#SessionResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SortDirection": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceFormat": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#SourceIdentity": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#Span": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#StatusResult": ['1.7.0'],
        "chronicle.api/:#TokenInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenRateWindow": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenResult": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokenSource": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#TokensResult": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#UserInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/:#VersionInfo": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityCollectors": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#Archive": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#McpTestItem]#Response": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolCall": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolResult": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Activity": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ApplyOwnerReindex": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Archive": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CancelMcpTest": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ExpressionHints": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetPassageSpans": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetPassages": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetReindexStatus": ['1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Invite": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LocateMessage": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Logout": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#McpTestTools": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ModelUsage": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#PreviewOwnerReindex": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#PreviewRetryFailed": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Purge": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ReadMcpTest": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Search": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#SearchSessionMessages": ['1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#StartMcpTest": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Activity": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#ActivityJobs": ['1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Archive": ['1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Chunks": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Error": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#ExpressionHints": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Facets": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Groups": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Hello": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#LocatedMessage": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#McpTestRun": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#McpTestTools": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Messages": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#ModelUsage": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Mutation": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexPreview": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexed": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#PassageSpans": ['1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Passages": ['1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Ping": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Pong": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Raw": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#ReindexStatus": ['1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Related": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#RetryFailed": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview": ['1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Search": ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Session": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#SessionMessageSearch": ['1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Status": ['1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Token": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Tokens": ['1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
        "chronicle.api/[chronicle.api/:#Result]#Whoami": ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "chronicle.api/:#ActivityCollector": { '1.7.0': 'identical' },
        "chronicle.api/:#ActivityCollectorSort": { '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJob": { '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobClass": { '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobScope": { '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobSort": { '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobsQuery": { '1.7.0': 'identical' },
        "chronicle.api/:#ActivityJobsResult": { '1.7.0': 'identical' },
        "chronicle.api/:#ActivityQuery": { '1.7.0': 'identical' },
        "chronicle.api/:#ActivityResult": { '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveQuery": { '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveResult": { '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveRow": { '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveSort": { '1.7.0': 'identical' },
        "chronicle.api/:#ArchiveTextScope": { '1.7.0': 'identical' },
        "chronicle.api/:#Chunk": { '1.7.0': 'identical' },
        "chronicle.api/:#ChunksResult": { '1.7.0': 'identical' },
        "chronicle.api/:#ClientEnvelope": { '1.7.0': 'identical' },
        "chronicle.api/:#CollectorCounters": { '1.7.0': 'identical' },
        "chronicle.api/:#CollectorPhase": { '1.7.0': 'identical' },
        "chronicle.api/:#CollectorProgressAck": { '1.7.0': 'identical' },
        "chronicle.api/:#CollectorProgressUpdate": { '1.7.0': 'identical' },
        "chronicle.api/:#CollectorStatus": { '1.7.0': 'identical' },
        "chronicle.api/:#CollectorStatusResult": { '1.7.0': 'identical' },
        "chronicle.api/:#Completion": { '1.7.0': 'identical' },
        "chronicle.api/:#ContentView": { '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHint": { '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintKind": { '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintQuery": { '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintTarget": { '1.7.0': 'identical' },
        "chronicle.api/:#ExpressionHintsResult": { '1.7.0': 'identical' },
        "chronicle.api/:#Facet": { '1.7.0': 'identical' },
        "chronicle.api/:#FacetsResult": { '1.7.0': 'identical' },
        "chronicle.api/:#Failure": { '1.7.0': 'identical' },
        "chronicle.api/:#GroupInfo": { '1.7.0': 'identical' },
        "chronicle.api/:#GroupsResult": { '1.7.0': 'identical' },
        "chronicle.api/:#IndexingFailureStage": { '1.7.0': 'identical' },
        "chronicle.api/:#IndexingSettings": { '1.7.0': 'identical' },
        "chronicle.api/:#IngestReceipt": { '1.7.0': 'identical' },
        "chronicle.api/:#IngestRequest": { '1.7.0': 'identical' },
        "chronicle.api/:#InviteInfo": { '1.7.0': 'identical' },
        "chronicle.api/:#JobCounts": { '1.7.0': 'identical' },
        "chronicle.api/:#JobInfo": { '1.7.0': 'identical' },
        "chronicle.api/:#JobState": { '1.7.0': 'identical' },
        "chronicle.api/:#ListedToken": { '1.7.0': 'identical' },
        "chronicle.api/:#LoginRequest": { '1.7.0': 'identical' },
        "chronicle.api/:#LoginResponse": { '1.7.0': 'identical' },
        "chronicle.api/:#McpTestCatalog": { '1.7.0': 'identical' },
        "chronicle.api/:#McpTestEvent": { '1.7.0': 'identical' },
        "chronicle.api/:#McpTestItem": { '1.7.0': 'identical' },
        "chronicle.api/:#McpTestLimits": { '1.7.0': 'identical' },
        "chronicle.api/:#McpTestSnapshot": { '1.7.0': 'identical' },
        "chronicle.api/:#McpTestState": { '1.7.0': 'identical' },
        "chronicle.api/:#McpToolDefinition": { '1.7.0': 'identical' },
        "chronicle.api/:#Message": { '1.7.0': 'identical' },
        "chronicle.api/:#MessageLocation": { '1.7.0': 'identical' },
        "chronicle.api/:#MessageSearchHit": { '1.7.0': 'identical' },
        "chronicle.api/:#MessagesResult": { '1.7.0': 'identical' },
        "chronicle.api/:#Metadata": { '1.7.0': 'identical' },
        "chronicle.api/:#ModelPurpose": { '1.7.0': 'identical' },
        "chronicle.api/:#ModelRateBasis": { '1.7.0': 'identical' },
        "chronicle.api/:#ModelUsageResult": { '1.7.0': 'identical' },
        "chronicle.api/:#ModelUsageSlice": { '1.7.0': 'identical' },
        "chronicle.api/:#MutationReceipt": { '1.7.0': 'identical' },
        "chronicle.api/:#Operation": { '1.7.0': 'identical' },
        "chronicle.api/:#OwnerReindexPlan": { '1.7.0': 'identical' },
        "chronicle.api/:#OwnerReindexResult": { '1.7.0': 'identical' },
        "chronicle.api/:#PassageFormat": { '1.7.0': 'identical' },
        "chronicle.api/:#PassageInfo": { '1.7.0': 'identical' },
        "chronicle.api/:#PassagePoint": { '1.7.0': 'identical' },
        "chronicle.api/:#PassageSourceSpan": { '1.7.0': 'identical' },
        "chronicle.api/:#PassageSpansResult": { '1.7.0': 'identical' },
        "chronicle.api/:#PassagesResult": { '1.7.0': 'identical' },
        "chronicle.api/:#RawFile": { '1.7.0': 'identical' },
        "chronicle.api/:#RawResult": { '1.7.0': 'identical' },
        "chronicle.api/:#ReindexStatusResult": { '1.7.0': 'identical' },
        "chronicle.api/:#RelatedResult": { '1.7.0': 'identical' },
        "chronicle.api/:#Result": { '1.7.0': 'identical' },
        "chronicle.api/:#RetryFailedCounts": { '1.7.0': 'identical' },
        "chronicle.api/:#RetryFailedPlan": { '1.7.0': 'identical' },
        "chronicle.api/:#RetryFailedResult": { '1.7.0': 'identical' },
        "chronicle.api/:#Scope": { '1.7.0': 'identical' },
        "chronicle.api/:#SearchCountScope": { '1.7.0': 'identical' },
        "chronicle.api/:#SearchFilter": { '1.7.0': 'identical' },
        "chronicle.api/:#SearchHit": { '1.7.0': 'identical' },
        "chronicle.api/:#SearchMode": { '1.7.0': 'identical' },
        "chronicle.api/:#SearchQuery": { '1.7.0': 'identical' },
        "chronicle.api/:#SearchResult": { '1.7.0': 'identical' },
        "chronicle.api/:#ServerEnvelope": { '1.7.0': 'identical' },
        "chronicle.api/:#SessionInfo": { '1.7.0': 'identical' },
        "chronicle.api/:#SessionMessageSearchResult": { '1.7.0': 'identical' },
        "chronicle.api/:#SessionResult": { '1.7.0': 'identical' },
        "chronicle.api/:#SortDirection": { '1.7.0': 'identical' },
        "chronicle.api/:#SourceFormat": { '1.7.0': 'identical' },
        "chronicle.api/:#SourceIdentity": { '1.7.0': 'identical' },
        "chronicle.api/:#Span": { '1.7.0': 'identical' },
        "chronicle.api/:#StatusResult": { '1.7.0': 'identical' },
        "chronicle.api/:#TokenInfo": { '1.7.0': 'identical' },
        "chronicle.api/:#TokenRateWindow": { '1.7.0': 'identical' },
        "chronicle.api/:#TokenResult": { '1.7.0': 'identical' },
        "chronicle.api/:#TokenSource": { '1.7.0': 'identical' },
        "chronicle.api/:#TokensResult": { '1.7.0': 'identical' },
        "chronicle.api/:#UserInfo": { '1.7.0': 'identical' },
        "chronicle.api/:#VersionInfo": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityCollectors": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#Archive": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#McpTestItem]#Response": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolCall": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolResult": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Activity": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ApplyOwnerReindex": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Archive": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CancelMcpTest": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ExpressionHints": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Facets": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetPassageSpans": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetPassages": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetReindexStatus": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Hello": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Invite": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LocateMessage": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Logout": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#McpTestTools": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ModelUsage": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Ping": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Pong": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#PreviewOwnerReindex": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#PreviewRetryFailed": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Purge": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ReadMcpTest": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Related": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Search": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#SearchSessionMessages": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#StartMcpTest": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Activity": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ActivityJobs": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Archive": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Chunks": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Error": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ExpressionHints": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Facets": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Groups": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Hello": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#LocatedMessage": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#McpTestRun": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#McpTestTools": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Messages": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ModelUsage": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Mutation": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexPreview": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexed": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#PassageSpans": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Passages": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Ping": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Pong": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Raw": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ReindexStatus": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Related": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#RetryFailed": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Search": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Session": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#SessionMessageSearch": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Status": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Token": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Tokens": { '1.7.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Whoami": { '1.7.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainChronicleApiV1_7_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainChronicleApiV1_7_0Meta.FORWARD[typeId] ?? {}; }
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
        this.register(
            new BaboonDomainVersion('chronicle.api', '1.4.0'),
            () => new DomainChronicleApiV1_4_0JsonCodecs(),
            () => new DomainChronicleApiV1_4_0UebaCodecs(),
            () => new DomainChronicleApiV1_4_0Conversions(),
            () => new DomainChronicleApiV1_4_0Meta(),
        );
        this.register(
            new BaboonDomainVersion('chronicle.api', '1.5.0'),
            () => new DomainChronicleApiV1_5_0JsonCodecs(),
            () => new DomainChronicleApiV1_5_0UebaCodecs(),
            () => new DomainChronicleApiV1_5_0Conversions(),
            () => new DomainChronicleApiV1_5_0Meta(),
        );
        this.register(
            new BaboonDomainVersion('chronicle.api', '1.6.0'),
            () => new DomainChronicleApiV1_6_0JsonCodecs(),
            () => new DomainChronicleApiV1_6_0UebaCodecs(),
            () => new DomainChronicleApiV1_6_0Conversions(),
            () => new DomainChronicleApiV1_6_0Meta(),
        );
        this.register(
            new BaboonDomainVersion('chronicle.api', '1.7.0'),
            () => new DomainChronicleApiV1_7_0JsonCodecs(),
            () => new DomainChronicleApiV1_7_0UebaCodecs(),
            () => new DomainChronicleApiV1_7_0Conversions(),
            () => new DomainChronicleApiV1_7_0Meta(),
        );
    }
}