import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ActivityJobsResult, ActivityJobsResult_JsonCodec} from './ActivityJobsResult.js'
import {ActivityResult, ActivityResult_JsonCodec} from './ActivityResult.js'
import {ArchiveResult, ArchiveResult_JsonCodec} from './ArchiveResult.js'
import {ChunksResult, ChunksResult_JsonCodec} from './ChunksResult.js'
import {CollectorStatusResult, CollectorStatusResult_JsonCodec} from './CollectorStatusResult.js'
import {ExpressionHintsResult, ExpressionHintsResult_JsonCodec} from './ExpressionHintsResult.js'
import {FacetsResult, FacetsResult_JsonCodec} from './FacetsResult.js'
import {Failure, Failure_JsonCodec} from './Failure.js'
import {GroupsResult, GroupsResult_JsonCodec} from './GroupsResult.js'
import {McpTestCatalog, McpTestCatalog_JsonCodec} from './McpTestCatalog.js'
import {McpTestSnapshot, McpTestSnapshot_JsonCodec} from './McpTestSnapshot.js'
import {MessageLocation, MessageLocation_JsonCodec} from './MessageLocation.js'
import {MessagesResult, MessagesResult_JsonCodec} from './MessagesResult.js'
import {ModelUsageResult, ModelUsageResult_JsonCodec} from './ModelUsageResult.js'
import {MutationReceipt, MutationReceipt_JsonCodec} from './MutationReceipt.js'
import {OwnerReindexPlan, OwnerReindexPlan_JsonCodec} from './OwnerReindexPlan.js'
import {OwnerReindexResult, OwnerReindexResult_JsonCodec} from './OwnerReindexResult.js'
import {PassageSpansResult, PassageSpansResult_JsonCodec} from './PassageSpansResult.js'
import {PassagesResult, PassagesResult_JsonCodec} from './PassagesResult.js'
import {RawResult, RawResult_JsonCodec} from './RawResult.js'
import {RelatedResult, RelatedResult_JsonCodec} from './RelatedResult.js'
import {RetryFailedPlan, RetryFailedPlan_JsonCodec} from './RetryFailedPlan.js'
import {RetryFailedResult, RetryFailedResult_JsonCodec} from './RetryFailedResult.js'
import {SearchResult, SearchResult_JsonCodec} from './SearchResult.js'
import {SessionResult, SessionResult_JsonCodec} from './SessionResult.js'
import {StatusResult, StatusResult_JsonCodec} from './StatusResult.js'
import {TokenResult, TokenResult_JsonCodec} from './TokenResult.js'
import {TokensResult, TokensResult_JsonCodec} from './TokensResult.js'
import {UserInfo, UserInfo_JsonCodec} from './UserInfo.js'
import {VersionInfo, VersionInfo_JsonCodec} from './VersionInfo.js'

export type Result = Result_Hello | Result_Pong | Result_Whoami | Result_Search | Result_Session | Result_Chunks | Result_Messages | Result_Raw | Result_Related | Result_Facets | Result_CollectionStatus | Result_Status | Result_Tokens | Result_Token | Result_Groups | Result_Mutation | Result_Error | Result_Ping | Result_Archive | Result_Activity | Result_ActivityJobs | Result_LocatedMessage | Result_RetryFailedPreview | Result_RetryFailed | Result_ExpressionHints | Result_ModelUsage | Result_Passages | Result_PassageSpans | Result_OwnerReindexPreview | Result_OwnerReindexed | Result_McpTestTools | Result_McpTestRun

export const Result = {
    BaboonDomainVersion: '1.4.0',
    BaboonDomainIdentifier: 'chronicle.api',
    BaboonTypeIdentifier: 'chronicle.api/:#Result',
    BaboonSameInVersions: ["1.4.0"],
    BaboonForwardReadable: { "1.4.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'chronicle.api/:#Result',
    jsonCodec(): Result_JsonCodec {
        return Result_JsonCodec.instance
    }
} as const

export class Result_Hello implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Hello' as const;
    private readonly _versions: VersionInfo;
    private readonly _user: UserInfo;

    constructor(versions: VersionInfo, user: UserInfo) {
        this._versions = versions
        this._user = user
    }

    public get versions(): VersionInfo {
        return this._versions;
    }
    public get user(): UserInfo {
        return this._user;
    }

    public toJSON(): Record<string, unknown> {
        return {
            versions: this._versions,
            user: this._user
        };
    }

    public with(overrides: {versions?: VersionInfo; user?: UserInfo}): Result_Hello {
        return new Result_Hello(
            'versions' in overrides ? overrides.versions! : this._versions,
            'user' in overrides ? overrides.user! : this._user
        );
    }

    public static fromPlain(obj: {versions: VersionInfo; user: UserInfo}): Result_Hello {
        return new Result_Hello(
            obj.versions,
            obj.user
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Hello.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Hello.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Hello'
    public baboonTypeIdentifier() {
        return Result_Hello.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Hello.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Hello.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Hello.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Hello.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Hello_JsonCodec {
        return Result_Hello_JsonCodec.instance
    }
}

export class Result_Hello_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Hello): unknown {
        if (this !== Result_Hello_JsonCodec.lazyInstance.value) {
          return Result_Hello_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "versions": VersionInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.versions),
            "user": UserInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.user),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Hello {
        if (this !== Result_Hello_JsonCodec .lazyInstance.value) {
            return Result_Hello_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Hello (
            VersionInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["versions"]),
            UserInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["user"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Hello_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Hello_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Hello'
    public baboonTypeIdentifier() {
        return Result_Hello_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Hello_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Hello_JsonCodec())
    public static get instance(): Result_Hello_JsonCodec {
        return Result_Hello_JsonCodec.lazyInstance.value
    }
}

export class Result_Pong implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Pong' as const;
    private readonly _nonce: string;

    constructor(nonce: string) {
        this._nonce = nonce
    }

    public get nonce(): string {
        return this._nonce;
    }

    public toJSON(): Record<string, unknown> {
        return {
            nonce: this._nonce
        };
    }

    public with(overrides: {nonce?: string}): Result_Pong {
        return new Result_Pong(
            'nonce' in overrides ? overrides.nonce! : this._nonce
        );
    }

    public static fromPlain(obj: {nonce: string}): Result_Pong {
        return new Result_Pong(
            obj.nonce
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Pong.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Pong.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Pong'
    public baboonTypeIdentifier() {
        return Result_Pong.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Pong.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Pong.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Pong.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Pong.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Pong_JsonCodec {
        return Result_Pong_JsonCodec.instance
    }
}

export class Result_Pong_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Pong): unknown {
        if (this !== Result_Pong_JsonCodec.lazyInstance.value) {
          return Result_Pong_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "nonce": value.nonce,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Pong {
        if (this !== Result_Pong_JsonCodec .lazyInstance.value) {
            return Result_Pong_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Pong (
            obj["nonce"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Pong_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Pong_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Pong'
    public baboonTypeIdentifier() {
        return Result_Pong_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Pong_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Pong_JsonCodec())
    public static get instance(): Result_Pong_JsonCodec {
        return Result_Pong_JsonCodec.lazyInstance.value
    }
}

export class Result_Whoami implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Whoami' as const;
    private readonly _user: UserInfo;

    constructor(user: UserInfo) {
        this._user = user
    }

    public get user(): UserInfo {
        return this._user;
    }

    public toJSON(): Record<string, unknown> {
        return {
            user: this._user
        };
    }

    public with(overrides: {user?: UserInfo}): Result_Whoami {
        return new Result_Whoami(
            'user' in overrides ? overrides.user! : this._user
        );
    }

    public static fromPlain(obj: {user: UserInfo}): Result_Whoami {
        return new Result_Whoami(
            obj.user
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Whoami.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Whoami.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Whoami'
    public baboonTypeIdentifier() {
        return Result_Whoami.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Whoami.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Whoami.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Whoami.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Whoami.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Whoami_JsonCodec {
        return Result_Whoami_JsonCodec.instance
    }
}

export class Result_Whoami_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Whoami): unknown {
        if (this !== Result_Whoami_JsonCodec.lazyInstance.value) {
          return Result_Whoami_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "user": UserInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.user),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Whoami {
        if (this !== Result_Whoami_JsonCodec .lazyInstance.value) {
            return Result_Whoami_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Whoami (
            UserInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["user"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Whoami_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Whoami_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Whoami'
    public baboonTypeIdentifier() {
        return Result_Whoami_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Whoami_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Whoami_JsonCodec())
    public static get instance(): Result_Whoami_JsonCodec {
        return Result_Whoami_JsonCodec.lazyInstance.value
    }
}

export class Result_Search implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Search' as const;
    private readonly _result: SearchResult;

    constructor(result: SearchResult) {
        this._result = result
    }

    public get result(): SearchResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: SearchResult}): Result_Search {
        return new Result_Search(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: SearchResult}): Result_Search {
        return new Result_Search(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Search.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Search.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Search'
    public baboonTypeIdentifier() {
        return Result_Search.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Search.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Search.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.1.0", "prefix-any-mode": "1.1.0", "identical": "1.1.0" }
    public baboonMinReaderVersions() {
        return Result_Search.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Search.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Search_JsonCodec {
        return Result_Search_JsonCodec.instance
    }
}

export class Result_Search_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Search): unknown {
        if (this !== Result_Search_JsonCodec.lazyInstance.value) {
          return Result_Search_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": SearchResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Search {
        if (this !== Result_Search_JsonCodec .lazyInstance.value) {
            return Result_Search_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Search (
            SearchResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Search_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Search_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Search'
    public baboonTypeIdentifier() {
        return Result_Search_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Search_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Search_JsonCodec())
    public static get instance(): Result_Search_JsonCodec {
        return Result_Search_JsonCodec.lazyInstance.value
    }
}

export class Result_Session implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Session' as const;
    private readonly _result: SessionResult;

    constructor(result: SessionResult) {
        this._result = result
    }

    public get result(): SessionResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: SessionResult}): Result_Session {
        return new Result_Session(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: SessionResult}): Result_Session {
        return new Result_Session(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Session.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Session.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Session'
    public baboonTypeIdentifier() {
        return Result_Session.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Session.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Session.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Session.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Session.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Session_JsonCodec {
        return Result_Session_JsonCodec.instance
    }
}

export class Result_Session_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Session): unknown {
        if (this !== Result_Session_JsonCodec.lazyInstance.value) {
          return Result_Session_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": SessionResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Session {
        if (this !== Result_Session_JsonCodec .lazyInstance.value) {
            return Result_Session_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Session (
            SessionResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Session_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Session_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Session'
    public baboonTypeIdentifier() {
        return Result_Session_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Session_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Session_JsonCodec())
    public static get instance(): Result_Session_JsonCodec {
        return Result_Session_JsonCodec.lazyInstance.value
    }
}

export class Result_Chunks implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Chunks' as const;
    private readonly _result: ChunksResult;

    constructor(result: ChunksResult) {
        this._result = result
    }

    public get result(): ChunksResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: ChunksResult}): Result_Chunks {
        return new Result_Chunks(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: ChunksResult}): Result_Chunks {
        return new Result_Chunks(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Chunks.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Chunks.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Chunks'
    public baboonTypeIdentifier() {
        return Result_Chunks.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Chunks.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Chunks.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Chunks.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Chunks.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Chunks_JsonCodec {
        return Result_Chunks_JsonCodec.instance
    }
}

export class Result_Chunks_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Chunks): unknown {
        if (this !== Result_Chunks_JsonCodec.lazyInstance.value) {
          return Result_Chunks_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": ChunksResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Chunks {
        if (this !== Result_Chunks_JsonCodec .lazyInstance.value) {
            return Result_Chunks_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Chunks (
            ChunksResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Chunks_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Chunks_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Chunks'
    public baboonTypeIdentifier() {
        return Result_Chunks_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Chunks_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Chunks_JsonCodec())
    public static get instance(): Result_Chunks_JsonCodec {
        return Result_Chunks_JsonCodec.lazyInstance.value
    }
}

export class Result_Messages implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Messages' as const;
    private readonly _result: MessagesResult;

    constructor(result: MessagesResult) {
        this._result = result
    }

    public get result(): MessagesResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: MessagesResult}): Result_Messages {
        return new Result_Messages(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: MessagesResult}): Result_Messages {
        return new Result_Messages(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Messages.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Messages.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Messages'
    public baboonTypeIdentifier() {
        return Result_Messages.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Messages.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Messages.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Messages.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Messages.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Messages_JsonCodec {
        return Result_Messages_JsonCodec.instance
    }
}

export class Result_Messages_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Messages): unknown {
        if (this !== Result_Messages_JsonCodec.lazyInstance.value) {
          return Result_Messages_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": MessagesResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Messages {
        if (this !== Result_Messages_JsonCodec .lazyInstance.value) {
            return Result_Messages_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Messages (
            MessagesResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Messages_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Messages_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Messages'
    public baboonTypeIdentifier() {
        return Result_Messages_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Messages_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Messages_JsonCodec())
    public static get instance(): Result_Messages_JsonCodec {
        return Result_Messages_JsonCodec.lazyInstance.value
    }
}

export class Result_Raw implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Raw' as const;
    private readonly _result: RawResult;

    constructor(result: RawResult) {
        this._result = result
    }

    public get result(): RawResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: RawResult}): Result_Raw {
        return new Result_Raw(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: RawResult}): Result_Raw {
        return new Result_Raw(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Raw.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Raw.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Raw'
    public baboonTypeIdentifier() {
        return Result_Raw.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Raw.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Raw.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Raw.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Raw.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Raw_JsonCodec {
        return Result_Raw_JsonCodec.instance
    }
}

export class Result_Raw_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Raw): unknown {
        if (this !== Result_Raw_JsonCodec.lazyInstance.value) {
          return Result_Raw_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": RawResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Raw {
        if (this !== Result_Raw_JsonCodec .lazyInstance.value) {
            return Result_Raw_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Raw (
            RawResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Raw_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Raw_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Raw'
    public baboonTypeIdentifier() {
        return Result_Raw_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Raw_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Raw_JsonCodec())
    public static get instance(): Result_Raw_JsonCodec {
        return Result_Raw_JsonCodec.lazyInstance.value
    }
}

export class Result_Related implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Related' as const;
    private readonly _result: RelatedResult;

    constructor(result: RelatedResult) {
        this._result = result
    }

    public get result(): RelatedResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: RelatedResult}): Result_Related {
        return new Result_Related(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: RelatedResult}): Result_Related {
        return new Result_Related(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Related.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Related.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Related'
    public baboonTypeIdentifier() {
        return Result_Related.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Related.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Related.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Related.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Related.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Related_JsonCodec {
        return Result_Related_JsonCodec.instance
    }
}

export class Result_Related_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Related): unknown {
        if (this !== Result_Related_JsonCodec.lazyInstance.value) {
          return Result_Related_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": RelatedResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Related {
        if (this !== Result_Related_JsonCodec .lazyInstance.value) {
            return Result_Related_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Related (
            RelatedResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Related_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Related_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Related'
    public baboonTypeIdentifier() {
        return Result_Related_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Related_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Related_JsonCodec())
    public static get instance(): Result_Related_JsonCodec {
        return Result_Related_JsonCodec.lazyInstance.value
    }
}

export class Result_Facets implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Facets' as const;
    private readonly _result: FacetsResult;

    constructor(result: FacetsResult) {
        this._result = result
    }

    public get result(): FacetsResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: FacetsResult}): Result_Facets {
        return new Result_Facets(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: FacetsResult}): Result_Facets {
        return new Result_Facets(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Facets.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Facets.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Facets'
    public baboonTypeIdentifier() {
        return Result_Facets.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Facets.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Facets.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Facets.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Facets.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Facets_JsonCodec {
        return Result_Facets_JsonCodec.instance
    }
}

export class Result_Facets_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Facets): unknown {
        if (this !== Result_Facets_JsonCodec.lazyInstance.value) {
          return Result_Facets_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": FacetsResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Facets {
        if (this !== Result_Facets_JsonCodec .lazyInstance.value) {
            return Result_Facets_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Facets (
            FacetsResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Facets_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Facets_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Facets'
    public baboonTypeIdentifier() {
        return Result_Facets_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Facets_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Facets_JsonCodec())
    public static get instance(): Result_Facets_JsonCodec {
        return Result_Facets_JsonCodec.lazyInstance.value
    }
}

export class Result_CollectionStatus implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#CollectionStatus' as const;
    private readonly _result: CollectorStatusResult;

    constructor(result: CollectorStatusResult) {
        this._result = result
    }

    public get result(): CollectorStatusResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: CollectorStatusResult}): Result_CollectionStatus {
        return new Result_CollectionStatus(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: CollectorStatusResult}): Result_CollectionStatus {
        return new Result_CollectionStatus(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_CollectionStatus.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_CollectionStatus.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#CollectionStatus'
    public baboonTypeIdentifier() {
        return Result_CollectionStatus.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_CollectionStatus.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_CollectionStatus.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.2.0", "prefix-compact": "1.2.0", "prefix-any-mode": "1.2.0", "identical": "1.2.0" }
    public baboonMinReaderVersions() {
        return Result_CollectionStatus.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_CollectionStatus.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_CollectionStatus_JsonCodec {
        return Result_CollectionStatus_JsonCodec.instance
    }
}

export class Result_CollectionStatus_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_CollectionStatus): unknown {
        if (this !== Result_CollectionStatus_JsonCodec.lazyInstance.value) {
          return Result_CollectionStatus_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": CollectorStatusResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_CollectionStatus {
        if (this !== Result_CollectionStatus_JsonCodec .lazyInstance.value) {
            return Result_CollectionStatus_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_CollectionStatus (
            CollectorStatusResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_CollectionStatus_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_CollectionStatus_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#CollectionStatus'
    public baboonTypeIdentifier() {
        return Result_CollectionStatus_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_CollectionStatus_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_CollectionStatus_JsonCodec())
    public static get instance(): Result_CollectionStatus_JsonCodec {
        return Result_CollectionStatus_JsonCodec.lazyInstance.value
    }
}

export class Result_Status implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Status' as const;
    private readonly _result: StatusResult;

    constructor(result: StatusResult) {
        this._result = result
    }

    public get result(): StatusResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: StatusResult}): Result_Status {
        return new Result_Status(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: StatusResult}): Result_Status {
        return new Result_Status(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Status.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Status.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Status'
    public baboonTypeIdentifier() {
        return Result_Status.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Status.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Status.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.2.0", "prefix-any-mode": "1.2.0", "identical": "1.2.0" }
    public baboonMinReaderVersions() {
        return Result_Status.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Status.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Status_JsonCodec {
        return Result_Status_JsonCodec.instance
    }
}

export class Result_Status_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Status): unknown {
        if (this !== Result_Status_JsonCodec.lazyInstance.value) {
          return Result_Status_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": StatusResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Status {
        if (this !== Result_Status_JsonCodec .lazyInstance.value) {
            return Result_Status_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Status (
            StatusResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Status_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Status_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Status'
    public baboonTypeIdentifier() {
        return Result_Status_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Status_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Status_JsonCodec())
    public static get instance(): Result_Status_JsonCodec {
        return Result_Status_JsonCodec.lazyInstance.value
    }
}

export class Result_Tokens implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Tokens' as const;
    private readonly _result: TokensResult;

    constructor(result: TokensResult) {
        this._result = result
    }

    public get result(): TokensResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: TokensResult}): Result_Tokens {
        return new Result_Tokens(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: TokensResult}): Result_Tokens {
        return new Result_Tokens(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Tokens.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Tokens.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Tokens'
    public baboonTypeIdentifier() {
        return Result_Tokens.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Tokens.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Tokens.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.2.0", "prefix-compact": "1.2.0", "prefix-any-mode": "1.2.0", "identical": "1.2.0" }
    public baboonMinReaderVersions() {
        return Result_Tokens.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Tokens.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Tokens_JsonCodec {
        return Result_Tokens_JsonCodec.instance
    }
}

export class Result_Tokens_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Tokens): unknown {
        if (this !== Result_Tokens_JsonCodec.lazyInstance.value) {
          return Result_Tokens_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": TokensResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Tokens {
        if (this !== Result_Tokens_JsonCodec .lazyInstance.value) {
            return Result_Tokens_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Tokens (
            TokensResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Tokens_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Tokens_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Tokens'
    public baboonTypeIdentifier() {
        return Result_Tokens_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Tokens_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Tokens_JsonCodec())
    public static get instance(): Result_Tokens_JsonCodec {
        return Result_Tokens_JsonCodec.lazyInstance.value
    }
}

export class Result_Token implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Token' as const;
    private readonly _result: TokenResult;

    constructor(result: TokenResult) {
        this._result = result
    }

    public get result(): TokenResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: TokenResult}): Result_Token {
        return new Result_Token(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: TokenResult}): Result_Token {
        return new Result_Token(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Token.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Token.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Token'
    public baboonTypeIdentifier() {
        return Result_Token.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Token.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Token.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Token.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Token.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Token_JsonCodec {
        return Result_Token_JsonCodec.instance
    }
}

export class Result_Token_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Token): unknown {
        if (this !== Result_Token_JsonCodec.lazyInstance.value) {
          return Result_Token_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": TokenResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Token {
        if (this !== Result_Token_JsonCodec .lazyInstance.value) {
            return Result_Token_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Token (
            TokenResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Token_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Token_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Token'
    public baboonTypeIdentifier() {
        return Result_Token_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Token_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Token_JsonCodec())
    public static get instance(): Result_Token_JsonCodec {
        return Result_Token_JsonCodec.lazyInstance.value
    }
}

export class Result_Groups implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Groups' as const;
    private readonly _result: GroupsResult;

    constructor(result: GroupsResult) {
        this._result = result
    }

    public get result(): GroupsResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: GroupsResult}): Result_Groups {
        return new Result_Groups(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: GroupsResult}): Result_Groups {
        return new Result_Groups(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Groups.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Groups.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Groups'
    public baboonTypeIdentifier() {
        return Result_Groups.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Groups.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Groups.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Groups.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Groups.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Groups_JsonCodec {
        return Result_Groups_JsonCodec.instance
    }
}

export class Result_Groups_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Groups): unknown {
        if (this !== Result_Groups_JsonCodec.lazyInstance.value) {
          return Result_Groups_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": GroupsResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Groups {
        if (this !== Result_Groups_JsonCodec .lazyInstance.value) {
            return Result_Groups_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Groups (
            GroupsResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Groups_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Groups_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Groups'
    public baboonTypeIdentifier() {
        return Result_Groups_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Groups_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Groups_JsonCodec())
    public static get instance(): Result_Groups_JsonCodec {
        return Result_Groups_JsonCodec.lazyInstance.value
    }
}

export class Result_Mutation implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Mutation' as const;
    private readonly _receipt: MutationReceipt;

    constructor(receipt: MutationReceipt) {
        this._receipt = receipt
    }

    public get receipt(): MutationReceipt {
        return this._receipt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            receipt: this._receipt
        };
    }

    public with(overrides: {receipt?: MutationReceipt}): Result_Mutation {
        return new Result_Mutation(
            'receipt' in overrides ? overrides.receipt! : this._receipt
        );
    }

    public static fromPlain(obj: {receipt: MutationReceipt}): Result_Mutation {
        return new Result_Mutation(
            obj.receipt
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Mutation.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Mutation.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Mutation'
    public baboonTypeIdentifier() {
        return Result_Mutation.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Mutation.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Mutation.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Mutation.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Mutation.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Mutation_JsonCodec {
        return Result_Mutation_JsonCodec.instance
    }
}

export class Result_Mutation_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Mutation): unknown {
        if (this !== Result_Mutation_JsonCodec.lazyInstance.value) {
          return Result_Mutation_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "receipt": MutationReceipt_JsonCodec.instance.encode(BaboonCodecContext.Default, value.receipt),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Mutation {
        if (this !== Result_Mutation_JsonCodec .lazyInstance.value) {
            return Result_Mutation_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Mutation (
            MutationReceipt_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["receipt"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Mutation_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Mutation_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Mutation'
    public baboonTypeIdentifier() {
        return Result_Mutation_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Mutation_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Mutation_JsonCodec())
    public static get instance(): Result_Mutation_JsonCodec {
        return Result_Mutation_JsonCodec.lazyInstance.value
    }
}

export class Result_Error implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Error' as const;
    private readonly _failure: Failure;

    constructor(failure: Failure) {
        this._failure = failure
    }

    public get failure(): Failure {
        return this._failure;
    }

    public toJSON(): Record<string, unknown> {
        return {
            failure: this._failure
        };
    }

    public with(overrides: {failure?: Failure}): Result_Error {
        return new Result_Error(
            'failure' in overrides ? overrides.failure! : this._failure
        );
    }

    public static fromPlain(obj: {failure: Failure}): Result_Error {
        return new Result_Error(
            obj.failure
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Error.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Error.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Error'
    public baboonTypeIdentifier() {
        return Result_Error.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Error.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Error.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Error.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Error.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Error_JsonCodec {
        return Result_Error_JsonCodec.instance
    }
}

export class Result_Error_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Error): unknown {
        if (this !== Result_Error_JsonCodec.lazyInstance.value) {
          return Result_Error_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "failure": Failure_JsonCodec.instance.encode(BaboonCodecContext.Default, value.failure),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Error {
        if (this !== Result_Error_JsonCodec .lazyInstance.value) {
            return Result_Error_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Error (
            Failure_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["failure"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Error_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Error_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Error'
    public baboonTypeIdentifier() {
        return Result_Error_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Error_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Error_JsonCodec())
    public static get instance(): Result_Error_JsonCodec {
        return Result_Error_JsonCodec.lazyInstance.value
    }
}

export class Result_Ping implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Ping' as const;
    private readonly _nonce: string;

    constructor(nonce: string) {
        this._nonce = nonce
    }

    public get nonce(): string {
        return this._nonce;
    }

    public toJSON(): Record<string, unknown> {
        return {
            nonce: this._nonce
        };
    }

    public with(overrides: {nonce?: string}): Result_Ping {
        return new Result_Ping(
            'nonce' in overrides ? overrides.nonce! : this._nonce
        );
    }

    public static fromPlain(obj: {nonce: string}): Result_Ping {
        return new Result_Ping(
            obj.nonce
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Ping.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Ping.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Ping'
    public baboonTypeIdentifier() {
        return Result_Ping.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Ping.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Ping.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Ping.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Ping.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Ping_JsonCodec {
        return Result_Ping_JsonCodec.instance
    }
}

export class Result_Ping_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Ping): unknown {
        if (this !== Result_Ping_JsonCodec.lazyInstance.value) {
          return Result_Ping_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "nonce": value.nonce,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Ping {
        if (this !== Result_Ping_JsonCodec .lazyInstance.value) {
            return Result_Ping_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Ping (
            obj["nonce"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Ping_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Ping_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Ping'
    public baboonTypeIdentifier() {
        return Result_Ping_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Ping_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Ping_JsonCodec())
    public static get instance(): Result_Ping_JsonCodec {
        return Result_Ping_JsonCodec.lazyInstance.value
    }
}

export class Result_Archive implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Archive' as const;
    private readonly _result: ArchiveResult;

    constructor(result: ArchiveResult) {
        this._result = result
    }

    public get result(): ArchiveResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: ArchiveResult}): Result_Archive {
        return new Result_Archive(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: ArchiveResult}): Result_Archive {
        return new Result_Archive(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Archive.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Archive.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Archive'
    public baboonTypeIdentifier() {
        return Result_Archive.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Archive.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Archive.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return Result_Archive.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Archive.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Archive_JsonCodec {
        return Result_Archive_JsonCodec.instance
    }
}

export class Result_Archive_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Archive): unknown {
        if (this !== Result_Archive_JsonCodec.lazyInstance.value) {
          return Result_Archive_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": ArchiveResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Archive {
        if (this !== Result_Archive_JsonCodec .lazyInstance.value) {
            return Result_Archive_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Archive (
            ArchiveResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Archive_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Archive_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Archive'
    public baboonTypeIdentifier() {
        return Result_Archive_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Archive_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Archive_JsonCodec())
    public static get instance(): Result_Archive_JsonCodec {
        return Result_Archive_JsonCodec.lazyInstance.value
    }
}

export class Result_Activity implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Activity' as const;
    private readonly _result: ActivityResult;

    constructor(result: ActivityResult) {
        this._result = result
    }

    public get result(): ActivityResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: ActivityResult}): Result_Activity {
        return new Result_Activity(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: ActivityResult}): Result_Activity {
        return new Result_Activity(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Activity.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Activity.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Activity'
    public baboonTypeIdentifier() {
        return Result_Activity.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_Activity.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Activity.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return Result_Activity.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Activity.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Activity_JsonCodec {
        return Result_Activity_JsonCodec.instance
    }
}

export class Result_Activity_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Activity): unknown {
        if (this !== Result_Activity_JsonCodec.lazyInstance.value) {
          return Result_Activity_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": ActivityResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Activity {
        if (this !== Result_Activity_JsonCodec .lazyInstance.value) {
            return Result_Activity_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Activity (
            ActivityResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Activity_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Activity_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Activity'
    public baboonTypeIdentifier() {
        return Result_Activity_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Activity_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Activity_JsonCodec())
    public static get instance(): Result_Activity_JsonCodec {
        return Result_Activity_JsonCodec.lazyInstance.value
    }
}

export class Result_ActivityJobs implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#ActivityJobs' as const;
    private readonly _result: ActivityJobsResult;

    constructor(result: ActivityJobsResult) {
        this._result = result
    }

    public get result(): ActivityJobsResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: ActivityJobsResult}): Result_ActivityJobs {
        return new Result_ActivityJobs(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: ActivityJobsResult}): Result_ActivityJobs {
        return new Result_ActivityJobs(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_ActivityJobs.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_ActivityJobs.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#ActivityJobs'
    public baboonTypeIdentifier() {
        return Result_ActivityJobs.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_ActivityJobs.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_ActivityJobs.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return Result_ActivityJobs.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_ActivityJobs.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_ActivityJobs_JsonCodec {
        return Result_ActivityJobs_JsonCodec.instance
    }
}

export class Result_ActivityJobs_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_ActivityJobs): unknown {
        if (this !== Result_ActivityJobs_JsonCodec.lazyInstance.value) {
          return Result_ActivityJobs_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": ActivityJobsResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_ActivityJobs {
        if (this !== Result_ActivityJobs_JsonCodec .lazyInstance.value) {
            return Result_ActivityJobs_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_ActivityJobs (
            ActivityJobsResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_ActivityJobs_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_ActivityJobs_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#ActivityJobs'
    public baboonTypeIdentifier() {
        return Result_ActivityJobs_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_ActivityJobs_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_ActivityJobs_JsonCodec())
    public static get instance(): Result_ActivityJobs_JsonCodec {
        return Result_ActivityJobs_JsonCodec.lazyInstance.value
    }
}

export class Result_LocatedMessage implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#LocatedMessage' as const;
    private readonly _result: MessageLocation;

    constructor(result: MessageLocation) {
        this._result = result
    }

    public get result(): MessageLocation {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: MessageLocation}): Result_LocatedMessage {
        return new Result_LocatedMessage(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: MessageLocation}): Result_LocatedMessage {
        return new Result_LocatedMessage(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_LocatedMessage.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_LocatedMessage.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#LocatedMessage'
    public baboonTypeIdentifier() {
        return Result_LocatedMessage.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_LocatedMessage.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_LocatedMessage.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return Result_LocatedMessage.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_LocatedMessage.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_LocatedMessage_JsonCodec {
        return Result_LocatedMessage_JsonCodec.instance
    }
}

export class Result_LocatedMessage_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_LocatedMessage): unknown {
        if (this !== Result_LocatedMessage_JsonCodec.lazyInstance.value) {
          return Result_LocatedMessage_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": MessageLocation_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_LocatedMessage {
        if (this !== Result_LocatedMessage_JsonCodec .lazyInstance.value) {
            return Result_LocatedMessage_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_LocatedMessage (
            MessageLocation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_LocatedMessage_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_LocatedMessage_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#LocatedMessage'
    public baboonTypeIdentifier() {
        return Result_LocatedMessage_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_LocatedMessage_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_LocatedMessage_JsonCodec())
    public static get instance(): Result_LocatedMessage_JsonCodec {
        return Result_LocatedMessage_JsonCodec.lazyInstance.value
    }
}

export class Result_RetryFailedPreview implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview' as const;
    private readonly _result: RetryFailedPlan;

    constructor(result: RetryFailedPlan) {
        this._result = result
    }

    public get result(): RetryFailedPlan {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: RetryFailedPlan}): Result_RetryFailedPreview {
        return new Result_RetryFailedPreview(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: RetryFailedPlan}): Result_RetryFailedPreview {
        return new Result_RetryFailedPreview(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_RetryFailedPreview.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_RetryFailedPreview.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview'
    public baboonTypeIdentifier() {
        return Result_RetryFailedPreview.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_RetryFailedPreview.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_RetryFailedPreview.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return Result_RetryFailedPreview.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_RetryFailedPreview.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_RetryFailedPreview_JsonCodec {
        return Result_RetryFailedPreview_JsonCodec.instance
    }
}

export class Result_RetryFailedPreview_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_RetryFailedPreview): unknown {
        if (this !== Result_RetryFailedPreview_JsonCodec.lazyInstance.value) {
          return Result_RetryFailedPreview_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": RetryFailedPlan_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_RetryFailedPreview {
        if (this !== Result_RetryFailedPreview_JsonCodec .lazyInstance.value) {
            return Result_RetryFailedPreview_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_RetryFailedPreview (
            RetryFailedPlan_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_RetryFailedPreview_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_RetryFailedPreview_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview'
    public baboonTypeIdentifier() {
        return Result_RetryFailedPreview_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_RetryFailedPreview_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_RetryFailedPreview_JsonCodec())
    public static get instance(): Result_RetryFailedPreview_JsonCodec {
        return Result_RetryFailedPreview_JsonCodec.lazyInstance.value
    }
}

export class Result_RetryFailed implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#RetryFailed' as const;
    private readonly _result: RetryFailedResult;

    constructor(result: RetryFailedResult) {
        this._result = result
    }

    public get result(): RetryFailedResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: RetryFailedResult}): Result_RetryFailed {
        return new Result_RetryFailed(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: RetryFailedResult}): Result_RetryFailed {
        return new Result_RetryFailed(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_RetryFailed.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_RetryFailed.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#RetryFailed'
    public baboonTypeIdentifier() {
        return Result_RetryFailed.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return Result_RetryFailed.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_RetryFailed.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return Result_RetryFailed.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_RetryFailed.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_RetryFailed_JsonCodec {
        return Result_RetryFailed_JsonCodec.instance
    }
}

export class Result_RetryFailed_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_RetryFailed): unknown {
        if (this !== Result_RetryFailed_JsonCodec.lazyInstance.value) {
          return Result_RetryFailed_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": RetryFailedResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_RetryFailed {
        if (this !== Result_RetryFailed_JsonCodec .lazyInstance.value) {
            return Result_RetryFailed_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_RetryFailed (
            RetryFailedResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_RetryFailed_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_RetryFailed_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#RetryFailed'
    public baboonTypeIdentifier() {
        return Result_RetryFailed_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_RetryFailed_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_RetryFailed_JsonCodec())
    public static get instance(): Result_RetryFailed_JsonCodec {
        return Result_RetryFailed_JsonCodec.lazyInstance.value
    }
}

export class Result_ExpressionHints implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#ExpressionHints' as const;
    private readonly _result: ExpressionHintsResult;

    constructor(result: ExpressionHintsResult) {
        this._result = result
    }

    public get result(): ExpressionHintsResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: ExpressionHintsResult}): Result_ExpressionHints {
        return new Result_ExpressionHints(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: ExpressionHintsResult}): Result_ExpressionHints {
        return new Result_ExpressionHints(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_ExpressionHints.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_ExpressionHints.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#ExpressionHints'
    public baboonTypeIdentifier() {
        return Result_ExpressionHints.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0"]
    public baboonSameInVersions() {
        return Result_ExpressionHints.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_ExpressionHints.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return Result_ExpressionHints.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_ExpressionHints.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_ExpressionHints_JsonCodec {
        return Result_ExpressionHints_JsonCodec.instance
    }
}

export class Result_ExpressionHints_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_ExpressionHints): unknown {
        if (this !== Result_ExpressionHints_JsonCodec.lazyInstance.value) {
          return Result_ExpressionHints_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": ExpressionHintsResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_ExpressionHints {
        if (this !== Result_ExpressionHints_JsonCodec .lazyInstance.value) {
            return Result_ExpressionHints_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_ExpressionHints (
            ExpressionHintsResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_ExpressionHints_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_ExpressionHints_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#ExpressionHints'
    public baboonTypeIdentifier() {
        return Result_ExpressionHints_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_ExpressionHints_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_ExpressionHints_JsonCodec())
    public static get instance(): Result_ExpressionHints_JsonCodec {
        return Result_ExpressionHints_JsonCodec.lazyInstance.value
    }
}

export class Result_ModelUsage implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#ModelUsage' as const;
    private readonly _result: ModelUsageResult;

    constructor(result: ModelUsageResult) {
        this._result = result
    }

    public get result(): ModelUsageResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: ModelUsageResult}): Result_ModelUsage {
        return new Result_ModelUsage(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: ModelUsageResult}): Result_ModelUsage {
        return new Result_ModelUsage(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_ModelUsage.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_ModelUsage.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#ModelUsage'
    public baboonTypeIdentifier() {
        return Result_ModelUsage.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0"]
    public baboonSameInVersions() {
        return Result_ModelUsage.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_ModelUsage.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return Result_ModelUsage.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_ModelUsage.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_ModelUsage_JsonCodec {
        return Result_ModelUsage_JsonCodec.instance
    }
}

export class Result_ModelUsage_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_ModelUsage): unknown {
        if (this !== Result_ModelUsage_JsonCodec.lazyInstance.value) {
          return Result_ModelUsage_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": ModelUsageResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_ModelUsage {
        if (this !== Result_ModelUsage_JsonCodec .lazyInstance.value) {
            return Result_ModelUsage_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_ModelUsage (
            ModelUsageResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_ModelUsage_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_ModelUsage_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#ModelUsage'
    public baboonTypeIdentifier() {
        return Result_ModelUsage_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_ModelUsage_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_ModelUsage_JsonCodec())
    public static get instance(): Result_ModelUsage_JsonCodec {
        return Result_ModelUsage_JsonCodec.lazyInstance.value
    }
}

export class Result_Passages implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#Passages' as const;
    private readonly _result: PassagesResult;

    constructor(result: PassagesResult) {
        this._result = result
    }

    public get result(): PassagesResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: PassagesResult}): Result_Passages {
        return new Result_Passages(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: PassagesResult}): Result_Passages {
        return new Result_Passages(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Passages.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Passages.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Passages'
    public baboonTypeIdentifier() {
        return Result_Passages.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0"]
    public baboonSameInVersions() {
        return Result_Passages.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_Passages.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return Result_Passages.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Passages.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Passages_JsonCodec {
        return Result_Passages_JsonCodec.instance
    }
}

export class Result_Passages_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Passages): unknown {
        if (this !== Result_Passages_JsonCodec.lazyInstance.value) {
          return Result_Passages_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": PassagesResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Passages {
        if (this !== Result_Passages_JsonCodec .lazyInstance.value) {
            return Result_Passages_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Passages (
            PassagesResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_Passages_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_Passages_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#Passages'
    public baboonTypeIdentifier() {
        return Result_Passages_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Passages_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Passages_JsonCodec())
    public static get instance(): Result_Passages_JsonCodec {
        return Result_Passages_JsonCodec.lazyInstance.value
    }
}

export class Result_PassageSpans implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#PassageSpans' as const;
    private readonly _result: PassageSpansResult;

    constructor(result: PassageSpansResult) {
        this._result = result
    }

    public get result(): PassageSpansResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: PassageSpansResult}): Result_PassageSpans {
        return new Result_PassageSpans(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: PassageSpansResult}): Result_PassageSpans {
        return new Result_PassageSpans(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_PassageSpans.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_PassageSpans.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#PassageSpans'
    public baboonTypeIdentifier() {
        return Result_PassageSpans.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0"]
    public baboonSameInVersions() {
        return Result_PassageSpans.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_PassageSpans.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return Result_PassageSpans.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_PassageSpans.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_PassageSpans_JsonCodec {
        return Result_PassageSpans_JsonCodec.instance
    }
}

export class Result_PassageSpans_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_PassageSpans): unknown {
        if (this !== Result_PassageSpans_JsonCodec.lazyInstance.value) {
          return Result_PassageSpans_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": PassageSpansResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_PassageSpans {
        if (this !== Result_PassageSpans_JsonCodec .lazyInstance.value) {
            return Result_PassageSpans_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_PassageSpans (
            PassageSpansResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_PassageSpans_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_PassageSpans_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#PassageSpans'
    public baboonTypeIdentifier() {
        return Result_PassageSpans_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_PassageSpans_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_PassageSpans_JsonCodec())
    public static get instance(): Result_PassageSpans_JsonCodec {
        return Result_PassageSpans_JsonCodec.lazyInstance.value
    }
}

export class Result_OwnerReindexPreview implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#OwnerReindexPreview' as const;
    private readonly _result: OwnerReindexPlan;

    constructor(result: OwnerReindexPlan) {
        this._result = result
    }

    public get result(): OwnerReindexPlan {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: OwnerReindexPlan}): Result_OwnerReindexPreview {
        return new Result_OwnerReindexPreview(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: OwnerReindexPlan}): Result_OwnerReindexPreview {
        return new Result_OwnerReindexPreview(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_OwnerReindexPreview.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_OwnerReindexPreview.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#OwnerReindexPreview'
    public baboonTypeIdentifier() {
        return Result_OwnerReindexPreview.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0"]
    public baboonSameInVersions() {
        return Result_OwnerReindexPreview.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_OwnerReindexPreview.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return Result_OwnerReindexPreview.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_OwnerReindexPreview.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_OwnerReindexPreview_JsonCodec {
        return Result_OwnerReindexPreview_JsonCodec.instance
    }
}

export class Result_OwnerReindexPreview_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_OwnerReindexPreview): unknown {
        if (this !== Result_OwnerReindexPreview_JsonCodec.lazyInstance.value) {
          return Result_OwnerReindexPreview_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": OwnerReindexPlan_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_OwnerReindexPreview {
        if (this !== Result_OwnerReindexPreview_JsonCodec .lazyInstance.value) {
            return Result_OwnerReindexPreview_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_OwnerReindexPreview (
            OwnerReindexPlan_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_OwnerReindexPreview_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_OwnerReindexPreview_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#OwnerReindexPreview'
    public baboonTypeIdentifier() {
        return Result_OwnerReindexPreview_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_OwnerReindexPreview_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_OwnerReindexPreview_JsonCodec())
    public static get instance(): Result_OwnerReindexPreview_JsonCodec {
        return Result_OwnerReindexPreview_JsonCodec.lazyInstance.value
    }
}

export class Result_OwnerReindexed implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#OwnerReindexed' as const;
    private readonly _result: OwnerReindexResult;

    constructor(result: OwnerReindexResult) {
        this._result = result
    }

    public get result(): OwnerReindexResult {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: OwnerReindexResult}): Result_OwnerReindexed {
        return new Result_OwnerReindexed(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: OwnerReindexResult}): Result_OwnerReindexed {
        return new Result_OwnerReindexed(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_OwnerReindexed.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_OwnerReindexed.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#OwnerReindexed'
    public baboonTypeIdentifier() {
        return Result_OwnerReindexed.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0"]
    public baboonSameInVersions() {
        return Result_OwnerReindexed.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_OwnerReindexed.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return Result_OwnerReindexed.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_OwnerReindexed.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_OwnerReindexed_JsonCodec {
        return Result_OwnerReindexed_JsonCodec.instance
    }
}

export class Result_OwnerReindexed_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_OwnerReindexed): unknown {
        if (this !== Result_OwnerReindexed_JsonCodec.lazyInstance.value) {
          return Result_OwnerReindexed_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": OwnerReindexResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_OwnerReindexed {
        if (this !== Result_OwnerReindexed_JsonCodec .lazyInstance.value) {
            return Result_OwnerReindexed_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_OwnerReindexed (
            OwnerReindexResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_OwnerReindexed_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_OwnerReindexed_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#OwnerReindexed'
    public baboonTypeIdentifier() {
        return Result_OwnerReindexed_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_OwnerReindexed_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_OwnerReindexed_JsonCodec())
    public static get instance(): Result_OwnerReindexed_JsonCodec {
        return Result_OwnerReindexed_JsonCodec.lazyInstance.value
    }
}

export class Result_McpTestTools implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#McpTestTools' as const;
    private readonly _result: McpTestCatalog;

    constructor(result: McpTestCatalog) {
        this._result = result
    }

    public get result(): McpTestCatalog {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: McpTestCatalog}): Result_McpTestTools {
        return new Result_McpTestTools(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: McpTestCatalog}): Result_McpTestTools {
        return new Result_McpTestTools(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_McpTestTools.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_McpTestTools.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#McpTestTools'
    public baboonTypeIdentifier() {
        return Result_McpTestTools.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0"]
    public baboonSameInVersions() {
        return Result_McpTestTools.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_McpTestTools.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return Result_McpTestTools.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_McpTestTools.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_McpTestTools_JsonCodec {
        return Result_McpTestTools_JsonCodec.instance
    }
}

export class Result_McpTestTools_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_McpTestTools): unknown {
        if (this !== Result_McpTestTools_JsonCodec.lazyInstance.value) {
          return Result_McpTestTools_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": McpTestCatalog_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_McpTestTools {
        if (this !== Result_McpTestTools_JsonCodec .lazyInstance.value) {
            return Result_McpTestTools_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_McpTestTools (
            McpTestCatalog_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_McpTestTools_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_McpTestTools_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#McpTestTools'
    public baboonTypeIdentifier() {
        return Result_McpTestTools_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_McpTestTools_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_McpTestTools_JsonCodec())
    public static get instance(): Result_McpTestTools_JsonCodec {
        return Result_McpTestTools_JsonCodec.lazyInstance.value
    }
}

export class Result_McpTestRun implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Result]#McpTestRun' as const;
    private readonly _result: McpTestSnapshot;

    constructor(result: McpTestSnapshot) {
        this._result = result
    }

    public get result(): McpTestSnapshot {
        return this._result;
    }

    public toJSON(): Record<string, unknown> {
        return {
            result: this._result
        };
    }

    public with(overrides: {result?: McpTestSnapshot}): Result_McpTestRun {
        return new Result_McpTestRun(
            'result' in overrides ? overrides.result! : this._result
        );
    }

    public static fromPlain(obj: {result: McpTestSnapshot}): Result_McpTestRun {
        return new Result_McpTestRun(
            obj.result
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_McpTestRun.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_McpTestRun.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#McpTestRun'
    public baboonTypeIdentifier() {
        return Result_McpTestRun.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0"]
    public baboonSameInVersions() {
        return Result_McpTestRun.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return Result_McpTestRun.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return Result_McpTestRun.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_McpTestRun.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_McpTestRun_JsonCodec {
        return Result_McpTestRun_JsonCodec.instance
    }
}

export class Result_McpTestRun_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_McpTestRun): unknown {
        if (this !== Result_McpTestRun_JsonCodec.lazyInstance.value) {
          return Result_McpTestRun_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "result": McpTestSnapshot_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_McpTestRun {
        if (this !== Result_McpTestRun_JsonCodec .lazyInstance.value) {
            return Result_McpTestRun_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_McpTestRun (
            McpTestSnapshot_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_McpTestRun_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_McpTestRun_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Result]#McpTestRun'
    public baboonTypeIdentifier() {
        return Result_McpTestRun_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_McpTestRun_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_McpTestRun_JsonCodec())
    public static get instance(): Result_McpTestRun_JsonCodec {
        return Result_McpTestRun_JsonCodec.lazyInstance.value
    }
}


export class Result_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result): unknown {
        if (this !== Result_JsonCodec.lazyInstance.value) {
          return Result_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof Result_Hello) {
                return { "Hello": Result_Hello_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Pong) {
                return { "Pong": Result_Pong_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Whoami) {
                return { "Whoami": Result_Whoami_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Search) {
                return { "Search": Result_Search_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Session) {
                return { "Session": Result_Session_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Chunks) {
                return { "Chunks": Result_Chunks_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Messages) {
                return { "Messages": Result_Messages_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Raw) {
                return { "Raw": Result_Raw_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Related) {
                return { "Related": Result_Related_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Facets) {
                return { "Facets": Result_Facets_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_CollectionStatus) {
                return { "CollectionStatus": Result_CollectionStatus_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Status) {
                return { "Status": Result_Status_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Tokens) {
                return { "Tokens": Result_Tokens_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Token) {
                return { "Token": Result_Token_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Groups) {
                return { "Groups": Result_Groups_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Mutation) {
                return { "Mutation": Result_Mutation_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Error) {
                return { "Error": Result_Error_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Ping) {
                return { "Ping": Result_Ping_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Archive) {
                return { "Archive": Result_Archive_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Activity) {
                return { "Activity": Result_Activity_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_ActivityJobs) {
                return { "ActivityJobs": Result_ActivityJobs_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_LocatedMessage) {
                return { "LocatedMessage": Result_LocatedMessage_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_RetryFailedPreview) {
                return { "RetryFailedPreview": Result_RetryFailedPreview_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_RetryFailed) {
                return { "RetryFailed": Result_RetryFailed_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_ExpressionHints) {
                return { "ExpressionHints": Result_ExpressionHints_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_ModelUsage) {
                return { "ModelUsage": Result_ModelUsage_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Passages) {
                return { "Passages": Result_Passages_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_PassageSpans) {
                return { "PassageSpans": Result_PassageSpans_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_OwnerReindexPreview) {
                return { "OwnerReindexPreview": Result_OwnerReindexPreview_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_OwnerReindexed) {
                return { "OwnerReindexed": Result_OwnerReindexed_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_McpTestTools) {
                return { "McpTestTools": Result_McpTestTools_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_McpTestRun) {
                return { "McpTestRun": Result_McpTestRun_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result {
        if (this !== Result_JsonCodec .lazyInstance.value) {
            return Result_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Hello": return Result_Hello_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Pong": return Result_Pong_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Whoami": return Result_Whoami_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Search": return Result_Search_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Session": return Result_Session_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Chunks": return Result_Chunks_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Messages": return Result_Messages_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Raw": return Result_Raw_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Related": return Result_Related_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Facets": return Result_Facets_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "CollectionStatus": return Result_CollectionStatus_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Status": return Result_Status_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Tokens": return Result_Tokens_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Token": return Result_Token_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Groups": return Result_Groups_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Mutation": return Result_Mutation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Error": return Result_Error_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Ping": return Result_Ping_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Archive": return Result_Archive_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Activity": return Result_Activity_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ActivityJobs": return Result_ActivityJobs_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "LocatedMessage": return Result_LocatedMessage_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "RetryFailedPreview": return Result_RetryFailedPreview_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "RetryFailed": return Result_RetryFailed_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ExpressionHints": return Result_ExpressionHints_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ModelUsage": return Result_ModelUsage_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Passages": return Result_Passages_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "PassageSpans": return Result_PassageSpans_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "OwnerReindexPreview": return Result_OwnerReindexPreview_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "OwnerReindexed": return Result_OwnerReindexed_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "McpTestTools": return Result_McpTestTools_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "McpTestRun": return Result_McpTestRun_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Result_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Result_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Result'
    public baboonTypeIdentifier() {
        return Result_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_JsonCodec())
    public static get instance(): Result_JsonCodec {
        return Result_JsonCodec.lazyInstance.value
    }
}