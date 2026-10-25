import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ChunksResult, ChunksResult_JsonCodec} from './ChunksResult.js'
import {FacetsResult, FacetsResult_JsonCodec} from './FacetsResult.js'
import {Failure, Failure_JsonCodec} from './Failure.js'
import {GroupsResult, GroupsResult_JsonCodec} from './GroupsResult.js'
import {MessagesResult, MessagesResult_JsonCodec} from './MessagesResult.js'
import {MutationReceipt, MutationReceipt_JsonCodec} from './MutationReceipt.js'
import {RawResult, RawResult_JsonCodec} from './RawResult.js'
import {RelatedResult, RelatedResult_JsonCodec} from './RelatedResult.js'
import {SearchResult, SearchResult_JsonCodec} from './SearchResult.js'
import {SessionResult, SessionResult_JsonCodec} from './SessionResult.js'
import {StatusResult, StatusResult_JsonCodec} from './StatusResult.js'
import {TokenResult, TokenResult_JsonCodec} from './TokenResult.js'
import {TokensResult, TokensResult_JsonCodec} from './TokensResult.js'
import {UserInfo, UserInfo_JsonCodec} from './UserInfo.js'
import {VersionInfo, VersionInfo_JsonCodec} from './VersionInfo.js'

export type Result = Result_Hello | Result_Pong | Result_Whoami | Result_Search | Result_Session | Result_Chunks | Result_Messages | Result_Raw | Result_Related | Result_Facets | Result_Status | Result_Tokens | Result_Token | Result_Groups | Result_Mutation | Result_Error | Result_Ping

export const Result = {
    BaboonDomainVersion: '1.1.0',
    BaboonDomainIdentifier: 'chronicle.api',
    BaboonTypeIdentifier: 'chronicle.api/:#Result',
    BaboonSameInVersions: ["1.1.0"],
    BaboonForwardReadable: { "1.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "1.0.0", "prefix-compact": "1.1.0", "prefix-any-mode": "1.1.0", "identical": "1.1.0" } as { readonly [tier: string]: string },
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Hello.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Pong.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Whoami.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.1.0"]
    public baboonSameInVersions() {
        return Result_Search.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Session.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Chunks.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Messages.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Raw.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Related.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Facets.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Status.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
    public baboonForwardReadable() {
        return Result_Status.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Tokens.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
    public baboonForwardReadable() {
        return Result_Tokens.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Token.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Groups.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Mutation.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Error.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return Result_Ping.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical" }
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

    public static readonly BaboonDomainVersion = '1.1.0'
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
                case "Status": return Result_Status_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Tokens": return Result_Tokens_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Token": return Result_Token_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Groups": return Result_Groups_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Mutation": return Result_Mutation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Error": return Result_Error_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Ping": return Result_Ping_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '1.1.0'
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