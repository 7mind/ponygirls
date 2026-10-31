

import { AbstractBaboonJsonCodecs, AbstractBaboonUebaCodecs, BaboonBinCodec, BaboonJsonCodec, BaboonDomainVersion, BaboonMeta, Lazy } from '../../BaboonSharedRuntime.js';
import type { AbstractBaboonConversions } from '../../BaboonSharedRuntime.js';
import { BaboonCodecsFacade } from '../../BaboonCodecsFacade.js';
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
import { ArchiveMatchKind, ArchiveMatchKind_JsonCodec } from './ArchiveMatchKind.js';
import { ArchiveQuery, ArchiveQuery_JsonCodec } from './ArchiveQuery.js';
import { ArchiveResult, ArchiveResult_JsonCodec } from './ArchiveResult.js';
import { ArchiveRow, ArchiveRow_JsonCodec } from './ArchiveRow.js';
import { ArchiveSearchEvidence, ArchiveSearchEvidence_JsonCodec } from './ArchiveSearchEvidence.js';
import { ArchiveSearchResult, ArchiveSearchResult_JsonCodec } from './ArchiveSearchResult.js';
import { ArchiveSort, ArchiveSort_JsonCodec } from './ArchiveSort.js';
import { ArchiveSourceMatch, ArchiveSourceMatch_JsonCodec } from './ArchiveSourceMatch.js';
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
import { ContextExcerpt, ContextExcerpt_JsonCodec } from './ContextExcerpt.js';
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
import { MessageContextResult, MessageContextResult_JsonCodec } from './MessageContextResult.js';
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

class DomainChronicleApiV1_9_0JsonCodecs extends AbstractBaboonJsonCodecs {
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
        this.register(ArchiveMatchKind_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveMatchKind_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveQuery_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveQuery_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveRow_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveRow_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveSearchEvidence_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveSearchEvidence_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveSearchResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveSearchResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveSort_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveSort_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ArchiveSourceMatch_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ArchiveSourceMatch_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
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
        this.register(ContextExcerpt_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ContextExcerpt_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
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
        this.register(MessageContextResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => MessageContextResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
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

class DomainChronicleApiV1_9_0UebaCodecs extends AbstractBaboonUebaCodecs {
    constructor() {
        super();
        
    }
}

class DomainChronicleApiV1_9_0Conversions implements AbstractBaboonConversions {
    public versionsFrom(): string[] { return []; }
    public versionTo(): string { return '1.9.0'; }
}

class DomainChronicleApiV1_9_0Meta implements BaboonMeta {
    private static readonly SAME_IN: { readonly [typeId: string]: readonly string[] } = {
        "chronicle.api/:#ActivityCollector": ['1.9.0'],
        "chronicle.api/:#ActivityCollectorSort": ['1.9.0'],
        "chronicle.api/:#ActivityJob": ['1.9.0'],
        "chronicle.api/:#ActivityJobClass": ['1.9.0'],
        "chronicle.api/:#ActivityJobScope": ['1.9.0'],
        "chronicle.api/:#ActivityJobSort": ['1.9.0'],
        "chronicle.api/:#ActivityJobsQuery": ['1.9.0'],
        "chronicle.api/:#ActivityJobsResult": ['1.9.0'],
        "chronicle.api/:#ActivityQuery": ['1.9.0'],
        "chronicle.api/:#ActivityResult": ['1.9.0'],
        "chronicle.api/:#ArchiveMatchKind": ['1.9.0'],
        "chronicle.api/:#ArchiveQuery": ['1.9.0'],
        "chronicle.api/:#ArchiveResult": ['1.9.0'],
        "chronicle.api/:#ArchiveRow": ['1.9.0'],
        "chronicle.api/:#ArchiveSearchEvidence": ['1.9.0'],
        "chronicle.api/:#ArchiveSearchResult": ['1.9.0'],
        "chronicle.api/:#ArchiveSort": ['1.9.0'],
        "chronicle.api/:#ArchiveSourceMatch": ['1.9.0'],
        "chronicle.api/:#ArchiveTextScope": ['1.9.0'],
        "chronicle.api/:#Chunk": ['1.9.0'],
        "chronicle.api/:#ChunksResult": ['1.9.0'],
        "chronicle.api/:#ClientEnvelope": ['1.9.0'],
        "chronicle.api/:#CollectorCounters": ['1.9.0'],
        "chronicle.api/:#CollectorPhase": ['1.9.0'],
        "chronicle.api/:#CollectorProgressAck": ['1.9.0'],
        "chronicle.api/:#CollectorProgressUpdate": ['1.9.0'],
        "chronicle.api/:#CollectorStatus": ['1.9.0'],
        "chronicle.api/:#CollectorStatusResult": ['1.9.0'],
        "chronicle.api/:#Completion": ['1.9.0'],
        "chronicle.api/:#ContentView": ['1.9.0'],
        "chronicle.api/:#ContextExcerpt": ['1.9.0'],
        "chronicle.api/:#ExpressionHint": ['1.9.0'],
        "chronicle.api/:#ExpressionHintKind": ['1.9.0'],
        "chronicle.api/:#ExpressionHintQuery": ['1.9.0'],
        "chronicle.api/:#ExpressionHintTarget": ['1.9.0'],
        "chronicle.api/:#ExpressionHintsResult": ['1.9.0'],
        "chronicle.api/:#Facet": ['1.9.0'],
        "chronicle.api/:#FacetsResult": ['1.9.0'],
        "chronicle.api/:#Failure": ['1.9.0'],
        "chronicle.api/:#GroupInfo": ['1.9.0'],
        "chronicle.api/:#GroupsResult": ['1.9.0'],
        "chronicle.api/:#IndexingFailureStage": ['1.9.0'],
        "chronicle.api/:#IndexingSettings": ['1.9.0'],
        "chronicle.api/:#IngestReceipt": ['1.9.0'],
        "chronicle.api/:#IngestRequest": ['1.9.0'],
        "chronicle.api/:#InviteInfo": ['1.9.0'],
        "chronicle.api/:#JobCounts": ['1.9.0'],
        "chronicle.api/:#JobInfo": ['1.9.0'],
        "chronicle.api/:#JobState": ['1.9.0'],
        "chronicle.api/:#ListedToken": ['1.9.0'],
        "chronicle.api/:#LoginRequest": ['1.9.0'],
        "chronicle.api/:#LoginResponse": ['1.9.0'],
        "chronicle.api/:#McpTestCatalog": ['1.9.0'],
        "chronicle.api/:#McpTestEvent": ['1.9.0'],
        "chronicle.api/:#McpTestItem": ['1.9.0'],
        "chronicle.api/:#McpTestLimits": ['1.9.0'],
        "chronicle.api/:#McpTestSnapshot": ['1.9.0'],
        "chronicle.api/:#McpTestState": ['1.9.0'],
        "chronicle.api/:#McpToolDefinition": ['1.9.0'],
        "chronicle.api/:#Message": ['1.9.0'],
        "chronicle.api/:#MessageContextResult": ['1.9.0'],
        "chronicle.api/:#MessageLocation": ['1.9.0'],
        "chronicle.api/:#MessageSearchHit": ['1.9.0'],
        "chronicle.api/:#MessagesResult": ['1.9.0'],
        "chronicle.api/:#Metadata": ['1.9.0'],
        "chronicle.api/:#ModelPurpose": ['1.9.0'],
        "chronicle.api/:#ModelRateBasis": ['1.9.0'],
        "chronicle.api/:#ModelUsageResult": ['1.9.0'],
        "chronicle.api/:#ModelUsageSlice": ['1.9.0'],
        "chronicle.api/:#MutationReceipt": ['1.9.0'],
        "chronicle.api/:#Operation": ['1.9.0'],
        "chronicle.api/:#OwnerReindexPlan": ['1.9.0'],
        "chronicle.api/:#OwnerReindexResult": ['1.9.0'],
        "chronicle.api/:#PassageFormat": ['1.9.0'],
        "chronicle.api/:#PassageInfo": ['1.9.0'],
        "chronicle.api/:#PassagePoint": ['1.9.0'],
        "chronicle.api/:#PassageSourceSpan": ['1.9.0'],
        "chronicle.api/:#PassageSpansResult": ['1.9.0'],
        "chronicle.api/:#PassagesResult": ['1.9.0'],
        "chronicle.api/:#RawFile": ['1.9.0'],
        "chronicle.api/:#RawResult": ['1.9.0'],
        "chronicle.api/:#ReindexStatusResult": ['1.9.0'],
        "chronicle.api/:#RelatedResult": ['1.9.0'],
        "chronicle.api/:#Result": ['1.9.0'],
        "chronicle.api/:#RetryFailedCounts": ['1.9.0'],
        "chronicle.api/:#RetryFailedPlan": ['1.9.0'],
        "chronicle.api/:#RetryFailedResult": ['1.9.0'],
        "chronicle.api/:#Scope": ['1.9.0'],
        "chronicle.api/:#SearchCountScope": ['1.9.0'],
        "chronicle.api/:#SearchFilter": ['1.9.0'],
        "chronicle.api/:#SearchHit": ['1.9.0'],
        "chronicle.api/:#SearchMode": ['1.9.0'],
        "chronicle.api/:#SearchQuery": ['1.9.0'],
        "chronicle.api/:#SearchResult": ['1.9.0'],
        "chronicle.api/:#ServerEnvelope": ['1.9.0'],
        "chronicle.api/:#SessionInfo": ['1.9.0'],
        "chronicle.api/:#SessionMessageSearchResult": ['1.9.0'],
        "chronicle.api/:#SessionResult": ['1.9.0'],
        "chronicle.api/:#SortDirection": ['1.9.0'],
        "chronicle.api/:#SourceFormat": ['1.9.0'],
        "chronicle.api/:#SourceIdentity": ['1.9.0'],
        "chronicle.api/:#Span": ['1.9.0'],
        "chronicle.api/:#StatusResult": ['1.9.0'],
        "chronicle.api/:#TokenInfo": ['1.9.0'],
        "chronicle.api/:#TokenRateWindow": ['1.9.0'],
        "chronicle.api/:#TokenResult": ['1.9.0'],
        "chronicle.api/:#TokenSource": ['1.9.0'],
        "chronicle.api/:#TokensResult": ['1.9.0'],
        "chronicle.api/:#UserInfo": ['1.9.0'],
        "chronicle.api/:#VersionInfo": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityCollectors": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#Archive": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#McpTestItem]#Response": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolCall": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolResult": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Activity": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ApplyOwnerReindex": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Archive": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ArchiveSearch": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CancelMcpTest": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ExpressionHints": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Facets": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetPassageSpans": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetPassages": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetReindexStatus": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Hello": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Invite": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#LocateMessage": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Logout": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#McpTestTools": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ModelUsage": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Ping": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Pong": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#PreviewOwnerReindex": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#PreviewRetryFailed": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Purge": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ReadMcpTest": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#ReadMessageContext": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Related": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Search": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#SearchSessionMessages": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#StartMcpTest": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Activity": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#ActivityJobs": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Archive": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#ArchiveSearch": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Chunks": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Error": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#ExpressionHints": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Facets": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Groups": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Hello": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#LocatedMessage": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#McpTestRun": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#McpTestTools": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#MessageContext": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Messages": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#ModelUsage": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Mutation": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexPreview": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexed": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#PassageSpans": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Passages": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Ping": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Pong": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Raw": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#ReindexStatus": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Related": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#RetryFailed": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Search": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Session": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#SessionMessageSearch": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Status": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Token": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Tokens": ['1.9.0'],
        "chronicle.api/[chronicle.api/:#Result]#Whoami": ['1.9.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "chronicle.api/:#ActivityCollector": { '1.9.0': 'identical' },
        "chronicle.api/:#ActivityCollectorSort": { '1.9.0': 'identical' },
        "chronicle.api/:#ActivityJob": { '1.9.0': 'identical' },
        "chronicle.api/:#ActivityJobClass": { '1.9.0': 'identical' },
        "chronicle.api/:#ActivityJobScope": { '1.9.0': 'identical' },
        "chronicle.api/:#ActivityJobSort": { '1.9.0': 'identical' },
        "chronicle.api/:#ActivityJobsQuery": { '1.9.0': 'identical' },
        "chronicle.api/:#ActivityJobsResult": { '1.9.0': 'identical' },
        "chronicle.api/:#ActivityQuery": { '1.9.0': 'identical' },
        "chronicle.api/:#ActivityResult": { '1.9.0': 'identical' },
        "chronicle.api/:#ArchiveMatchKind": { '1.9.0': 'identical' },
        "chronicle.api/:#ArchiveQuery": { '1.9.0': 'identical' },
        "chronicle.api/:#ArchiveResult": { '1.9.0': 'identical' },
        "chronicle.api/:#ArchiveRow": { '1.9.0': 'identical' },
        "chronicle.api/:#ArchiveSearchEvidence": { '1.9.0': 'identical' },
        "chronicle.api/:#ArchiveSearchResult": { '1.9.0': 'identical' },
        "chronicle.api/:#ArchiveSort": { '1.9.0': 'identical' },
        "chronicle.api/:#ArchiveSourceMatch": { '1.9.0': 'identical' },
        "chronicle.api/:#ArchiveTextScope": { '1.9.0': 'identical' },
        "chronicle.api/:#Chunk": { '1.9.0': 'identical' },
        "chronicle.api/:#ChunksResult": { '1.9.0': 'identical' },
        "chronicle.api/:#ClientEnvelope": { '1.9.0': 'identical' },
        "chronicle.api/:#CollectorCounters": { '1.9.0': 'identical' },
        "chronicle.api/:#CollectorPhase": { '1.9.0': 'identical' },
        "chronicle.api/:#CollectorProgressAck": { '1.9.0': 'identical' },
        "chronicle.api/:#CollectorProgressUpdate": { '1.9.0': 'identical' },
        "chronicle.api/:#CollectorStatus": { '1.9.0': 'identical' },
        "chronicle.api/:#CollectorStatusResult": { '1.9.0': 'identical' },
        "chronicle.api/:#Completion": { '1.9.0': 'identical' },
        "chronicle.api/:#ContentView": { '1.9.0': 'identical' },
        "chronicle.api/:#ContextExcerpt": { '1.9.0': 'identical' },
        "chronicle.api/:#ExpressionHint": { '1.9.0': 'identical' },
        "chronicle.api/:#ExpressionHintKind": { '1.9.0': 'identical' },
        "chronicle.api/:#ExpressionHintQuery": { '1.9.0': 'identical' },
        "chronicle.api/:#ExpressionHintTarget": { '1.9.0': 'identical' },
        "chronicle.api/:#ExpressionHintsResult": { '1.9.0': 'identical' },
        "chronicle.api/:#Facet": { '1.9.0': 'identical' },
        "chronicle.api/:#FacetsResult": { '1.9.0': 'identical' },
        "chronicle.api/:#Failure": { '1.9.0': 'identical' },
        "chronicle.api/:#GroupInfo": { '1.9.0': 'identical' },
        "chronicle.api/:#GroupsResult": { '1.9.0': 'identical' },
        "chronicle.api/:#IndexingFailureStage": { '1.9.0': 'identical' },
        "chronicle.api/:#IndexingSettings": { '1.9.0': 'identical' },
        "chronicle.api/:#IngestReceipt": { '1.9.0': 'identical' },
        "chronicle.api/:#IngestRequest": { '1.9.0': 'identical' },
        "chronicle.api/:#InviteInfo": { '1.9.0': 'identical' },
        "chronicle.api/:#JobCounts": { '1.9.0': 'identical' },
        "chronicle.api/:#JobInfo": { '1.9.0': 'identical' },
        "chronicle.api/:#JobState": { '1.9.0': 'identical' },
        "chronicle.api/:#ListedToken": { '1.9.0': 'identical' },
        "chronicle.api/:#LoginRequest": { '1.9.0': 'identical' },
        "chronicle.api/:#LoginResponse": { '1.9.0': 'identical' },
        "chronicle.api/:#McpTestCatalog": { '1.9.0': 'identical' },
        "chronicle.api/:#McpTestEvent": { '1.9.0': 'identical' },
        "chronicle.api/:#McpTestItem": { '1.9.0': 'identical' },
        "chronicle.api/:#McpTestLimits": { '1.9.0': 'identical' },
        "chronicle.api/:#McpTestSnapshot": { '1.9.0': 'identical' },
        "chronicle.api/:#McpTestState": { '1.9.0': 'identical' },
        "chronicle.api/:#McpToolDefinition": { '1.9.0': 'identical' },
        "chronicle.api/:#Message": { '1.9.0': 'identical' },
        "chronicle.api/:#MessageContextResult": { '1.9.0': 'identical' },
        "chronicle.api/:#MessageLocation": { '1.9.0': 'identical' },
        "chronicle.api/:#MessageSearchHit": { '1.9.0': 'identical' },
        "chronicle.api/:#MessagesResult": { '1.9.0': 'identical' },
        "chronicle.api/:#Metadata": { '1.9.0': 'identical' },
        "chronicle.api/:#ModelPurpose": { '1.9.0': 'identical' },
        "chronicle.api/:#ModelRateBasis": { '1.9.0': 'identical' },
        "chronicle.api/:#ModelUsageResult": { '1.9.0': 'identical' },
        "chronicle.api/:#ModelUsageSlice": { '1.9.0': 'identical' },
        "chronicle.api/:#MutationReceipt": { '1.9.0': 'identical' },
        "chronicle.api/:#Operation": { '1.9.0': 'identical' },
        "chronicle.api/:#OwnerReindexPlan": { '1.9.0': 'identical' },
        "chronicle.api/:#OwnerReindexResult": { '1.9.0': 'identical' },
        "chronicle.api/:#PassageFormat": { '1.9.0': 'identical' },
        "chronicle.api/:#PassageInfo": { '1.9.0': 'identical' },
        "chronicle.api/:#PassagePoint": { '1.9.0': 'identical' },
        "chronicle.api/:#PassageSourceSpan": { '1.9.0': 'identical' },
        "chronicle.api/:#PassageSpansResult": { '1.9.0': 'identical' },
        "chronicle.api/:#PassagesResult": { '1.9.0': 'identical' },
        "chronicle.api/:#RawFile": { '1.9.0': 'identical' },
        "chronicle.api/:#RawResult": { '1.9.0': 'identical' },
        "chronicle.api/:#ReindexStatusResult": { '1.9.0': 'identical' },
        "chronicle.api/:#RelatedResult": { '1.9.0': 'identical' },
        "chronicle.api/:#Result": { '1.9.0': 'identical' },
        "chronicle.api/:#RetryFailedCounts": { '1.9.0': 'identical' },
        "chronicle.api/:#RetryFailedPlan": { '1.9.0': 'identical' },
        "chronicle.api/:#RetryFailedResult": { '1.9.0': 'identical' },
        "chronicle.api/:#Scope": { '1.9.0': 'identical' },
        "chronicle.api/:#SearchCountScope": { '1.9.0': 'identical' },
        "chronicle.api/:#SearchFilter": { '1.9.0': 'identical' },
        "chronicle.api/:#SearchHit": { '1.9.0': 'identical' },
        "chronicle.api/:#SearchMode": { '1.9.0': 'identical' },
        "chronicle.api/:#SearchQuery": { '1.9.0': 'identical' },
        "chronicle.api/:#SearchResult": { '1.9.0': 'identical' },
        "chronicle.api/:#ServerEnvelope": { '1.9.0': 'identical' },
        "chronicle.api/:#SessionInfo": { '1.9.0': 'identical' },
        "chronicle.api/:#SessionMessageSearchResult": { '1.9.0': 'identical' },
        "chronicle.api/:#SessionResult": { '1.9.0': 'identical' },
        "chronicle.api/:#SortDirection": { '1.9.0': 'identical' },
        "chronicle.api/:#SourceFormat": { '1.9.0': 'identical' },
        "chronicle.api/:#SourceIdentity": { '1.9.0': 'identical' },
        "chronicle.api/:#Span": { '1.9.0': 'identical' },
        "chronicle.api/:#StatusResult": { '1.9.0': 'identical' },
        "chronicle.api/:#TokenInfo": { '1.9.0': 'identical' },
        "chronicle.api/:#TokenRateWindow": { '1.9.0': 'identical' },
        "chronicle.api/:#TokenResult": { '1.9.0': 'identical' },
        "chronicle.api/:#TokenSource": { '1.9.0': 'identical' },
        "chronicle.api/:#TokensResult": { '1.9.0': 'identical' },
        "chronicle.api/:#UserInfo": { '1.9.0': 'identical' },
        "chronicle.api/:#VersionInfo": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityCollectors": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#Archive": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#McpTestItem]#Response": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolCall": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#McpTestItem]#ToolResult": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Activity": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ApplyOwnerReindex": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Archive": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ArchiveSearch": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CancelMcpTest": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CollectionStatus": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#CreateGroup": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ExpressionHints": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Facets": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetChunks": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetMessages": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetPassageSpans": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetPassages": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetRaw": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetReindexStatus": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#GetSession": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Hello": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#IngestStatus": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Invite": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListGroups": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ListTokens": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#LocateMessage": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Logout": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#McpTestTools": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#MintToken": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ModelUsage": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Ping": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Pong": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#PreviewOwnerReindex": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#PreviewRetryFailed": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Purge": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ReadMcpTest": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#ReadMessageContext": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Receipt": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Related": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RemoveMember": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RetryJob": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#RevokeToken": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Search": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#SearchSessionMessages": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#StartMcpTest": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Operation]#Whoami": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Activity": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ActivityJobs": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Archive": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ArchiveSearch": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Chunks": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#CollectionStatus": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Error": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ExpressionHints": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Facets": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Groups": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Hello": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#LocatedMessage": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#McpTestRun": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#McpTestTools": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#MessageContext": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Messages": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ModelUsage": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Mutation": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexPreview": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#OwnerReindexed": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#PassageSpans": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Passages": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Ping": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Pong": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Raw": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#ReindexStatus": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Related": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#RetryFailed": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Search": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Session": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#SessionMessageSearch": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Status": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Token": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Tokens": { '1.9.0': 'identical' },
        "chronicle.api/[chronicle.api/:#Result]#Whoami": { '1.9.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainChronicleApiV1_9_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainChronicleApiV1_9_0Meta.FORWARD[typeId] ?? {}; }
}

export class DomainChronicleApiFacade extends BaboonCodecsFacade {
    constructor() {
        super();
        this.register(
            new BaboonDomainVersion('chronicle.api', '1.9.0'),
            () => new DomainChronicleApiV1_9_0JsonCodecs(),
            () => new DomainChronicleApiV1_9_0UebaCodecs(),
            () => new DomainChronicleApiV1_9_0Conversions(),
            () => new DomainChronicleApiV1_9_0Meta(),
        );
    }
}