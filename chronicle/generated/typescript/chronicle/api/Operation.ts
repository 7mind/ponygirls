import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ActivityJobsQuery, ActivityJobsQuery_JsonCodec} from './ActivityJobsQuery.js'
import {ActivityQuery, ActivityQuery_JsonCodec} from './ActivityQuery.js'
import {ArchiveQuery, ArchiveQuery_JsonCodec} from './ArchiveQuery.js'
import {ContentView, ContentView_JsonCodec} from './ContentView.js'
import {Scope, Scope_JsonCodec} from './Scope.js'
import {SearchFilter, SearchFilter_JsonCodec} from './SearchFilter.js'
import {SearchQuery, SearchQuery_JsonCodec} from './SearchQuery.js'

export type Operation = Operation_Hello | Operation_Ping | Operation_Pong | Operation_Whoami | Operation_Search | Operation_GetSession | Operation_GetChunks | Operation_GetMessages | Operation_GetRaw | Operation_Related | Operation_Facets | Operation_CollectionStatus | Operation_IngestStatus | Operation_RetryJob | Operation_ListTokens | Operation_MintToken | Operation_RevokeToken | Operation_ListGroups | Operation_CreateGroup | Operation_Invite | Operation_AcceptInvite | Operation_RemoveMember | Operation_LeaveGroup | Operation_DeleteGroup | Operation_Receipt | Operation_Purge | Operation_Logout | Operation_Archive | Operation_Activity | Operation_ActivityJobs | Operation_LocateMessage | Operation_PreviewRetryFailed | Operation_ApplyRetryFailed

export const Operation = {
    BaboonDomainVersion: '1.3.0',
    BaboonDomainIdentifier: 'chronicle.api',
    BaboonTypeIdentifier: 'chronicle.api/:#Operation',
    BaboonSameInVersions: ["1.3.0"],
    BaboonForwardReadable: { "1.3.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'chronicle.api/:#Operation',
    jsonCodec(): Operation_JsonCodec {
        return Operation_JsonCodec.instance
    }
} as const

export class Operation_Hello implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#Hello' as const;
    private readonly _versions: Array<string>;

    constructor(versions: Array<string>) {
        this._versions = versions
    }

    public get versions(): Array<string> {
        return this._versions;
    }

    public toJSON(): Record<string, unknown> {
        return {
            versions: this._versions
        };
    }

    public with(overrides: {versions?: Array<string>}): Operation_Hello {
        return new Operation_Hello(
            'versions' in overrides ? overrides.versions! : this._versions
        );
    }

    public static fromPlain(obj: {versions: Array<string>}): Operation_Hello {
        return new Operation_Hello(
            obj.versions
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Hello.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Hello.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Hello'
    public baboonTypeIdentifier() {
        return Operation_Hello.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_Hello.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Hello.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_Hello.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Hello.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Hello_JsonCodec {
        return Operation_Hello_JsonCodec.instance
    }
}

export class Operation_Hello_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Hello): unknown {
        if (this !== Operation_Hello_JsonCodec.lazyInstance.value) {
          return Operation_Hello_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "versions": Array.from(value.versions),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Hello {
        if (this !== Operation_Hello_JsonCodec .lazyInstance.value) {
            return Operation_Hello_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Hello (
            (obj["versions"] as unknown[]).map(item => item as string),
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Hello_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Hello_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Hello'
    public baboonTypeIdentifier() {
        return Operation_Hello_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Hello_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Hello_JsonCodec())
    public static get instance(): Operation_Hello_JsonCodec {
        return Operation_Hello_JsonCodec.lazyInstance.value
    }
}

export class Operation_Ping implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#Ping' as const;
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

    public with(overrides: {nonce?: string}): Operation_Ping {
        return new Operation_Ping(
            'nonce' in overrides ? overrides.nonce! : this._nonce
        );
    }

    public static fromPlain(obj: {nonce: string}): Operation_Ping {
        return new Operation_Ping(
            obj.nonce
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Ping.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Ping.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Ping'
    public baboonTypeIdentifier() {
        return Operation_Ping.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_Ping.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Ping.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_Ping.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Ping.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Ping_JsonCodec {
        return Operation_Ping_JsonCodec.instance
    }
}

export class Operation_Ping_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Ping): unknown {
        if (this !== Operation_Ping_JsonCodec.lazyInstance.value) {
          return Operation_Ping_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "nonce": value.nonce,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Ping {
        if (this !== Operation_Ping_JsonCodec .lazyInstance.value) {
            return Operation_Ping_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Ping (
            obj["nonce"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Ping_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Ping_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Ping'
    public baboonTypeIdentifier() {
        return Operation_Ping_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Ping_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Ping_JsonCodec())
    public static get instance(): Operation_Ping_JsonCodec {
        return Operation_Ping_JsonCodec.lazyInstance.value
    }
}

export class Operation_Pong implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#Pong' as const;
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

    public with(overrides: {nonce?: string}): Operation_Pong {
        return new Operation_Pong(
            'nonce' in overrides ? overrides.nonce! : this._nonce
        );
    }

    public static fromPlain(obj: {nonce: string}): Operation_Pong {
        return new Operation_Pong(
            obj.nonce
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Pong.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Pong.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Pong'
    public baboonTypeIdentifier() {
        return Operation_Pong.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_Pong.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Pong.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_Pong.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Pong.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Pong_JsonCodec {
        return Operation_Pong_JsonCodec.instance
    }
}

export class Operation_Pong_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Pong): unknown {
        if (this !== Operation_Pong_JsonCodec.lazyInstance.value) {
          return Operation_Pong_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "nonce": value.nonce,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Pong {
        if (this !== Operation_Pong_JsonCodec .lazyInstance.value) {
            return Operation_Pong_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Pong (
            obj["nonce"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Pong_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Pong_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Pong'
    public baboonTypeIdentifier() {
        return Operation_Pong_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Pong_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Pong_JsonCodec())
    public static get instance(): Operation_Pong_JsonCodec {
        return Operation_Pong_JsonCodec.lazyInstance.value
    }
}

export class Operation_Whoami implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#Whoami' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): Operation_Whoami {
        return new Operation_Whoami(
            
        );
    }

    public static fromPlain(obj: {}): Operation_Whoami {
        return new Operation_Whoami(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Whoami.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Whoami.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Whoami'
    public baboonTypeIdentifier() {
        return Operation_Whoami.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_Whoami.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Whoami.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_Whoami.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Whoami.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Whoami_JsonCodec {
        return Operation_Whoami_JsonCodec.instance
    }
}

export class Operation_Whoami_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Whoami): unknown {
        if (this !== Operation_Whoami_JsonCodec.lazyInstance.value) {
          return Operation_Whoami_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Whoami {
        if (this !== Operation_Whoami_JsonCodec .lazyInstance.value) {
            return Operation_Whoami_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Whoami (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Whoami_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Whoami_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Whoami'
    public baboonTypeIdentifier() {
        return Operation_Whoami_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Whoami_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Whoami_JsonCodec())
    public static get instance(): Operation_Whoami_JsonCodec {
        return Operation_Whoami_JsonCodec.lazyInstance.value
    }
}

export class Operation_Search implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#Search' as const;
    private readonly _query: SearchQuery;

    constructor(query: SearchQuery) {
        this._query = query
    }

    public get query(): SearchQuery {
        return this._query;
    }

    public toJSON(): Record<string, unknown> {
        return {
            query: this._query
        };
    }

    public with(overrides: {query?: SearchQuery}): Operation_Search {
        return new Operation_Search(
            'query' in overrides ? overrides.query! : this._query
        );
    }

    public static fromPlain(obj: {query: SearchQuery}): Operation_Search {
        return new Operation_Search(
            obj.query
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Search.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Search.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Search'
    public baboonTypeIdentifier() {
        return Operation_Search.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_Search.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Search.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_Search.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Search.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Search_JsonCodec {
        return Operation_Search_JsonCodec.instance
    }
}

export class Operation_Search_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Search): unknown {
        if (this !== Operation_Search_JsonCodec.lazyInstance.value) {
          return Operation_Search_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "query": SearchQuery_JsonCodec.instance.encode(BaboonCodecContext.Default, value.query),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Search {
        if (this !== Operation_Search_JsonCodec .lazyInstance.value) {
            return Operation_Search_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Search (
            SearchQuery_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["query"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Search_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Search_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Search'
    public baboonTypeIdentifier() {
        return Operation_Search_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Search_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Search_JsonCodec())
    public static get instance(): Operation_Search_JsonCodec {
        return Operation_Search_JsonCodec.lazyInstance.value
    }
}

export class Operation_GetSession implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#GetSession' as const;
    private readonly _sessionId: string;
    private readonly _view: ContentView | undefined;

    constructor(sessionId: string, view: ContentView | undefined) {
        this._sessionId = sessionId
        this._view = view
    }

    public get sessionId(): string {
        return this._sessionId;
    }
    public get view(): ContentView | undefined {
        return this._view;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sessionId: this._sessionId,
            view: this._view !== undefined ? this._view : undefined
        };
    }

    public with(overrides: {sessionId?: string; view?: ContentView | undefined}): Operation_GetSession {
        return new Operation_GetSession(
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId,
            'view' in overrides ? overrides.view! : this._view
        );
    }

    public static fromPlain(obj: {sessionId: string; view: ContentView | undefined}): Operation_GetSession {
        return new Operation_GetSession(
            obj.sessionId,
            obj.view
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_GetSession.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_GetSession.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#GetSession'
    public baboonTypeIdentifier() {
        return Operation_GetSession.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_GetSession.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_GetSession.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_GetSession.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_GetSession.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_GetSession_JsonCodec {
        return Operation_GetSession_JsonCodec.instance
    }
}

export class Operation_GetSession_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_GetSession): unknown {
        if (this !== Operation_GetSession_JsonCodec.lazyInstance.value) {
          return Operation_GetSession_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sessionId": value.sessionId,
            "view": value.view === undefined ? null : ContentView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.view),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_GetSession {
        if (this !== Operation_GetSession_JsonCodec .lazyInstance.value) {
            return Operation_GetSession_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_GetSession (
            obj["sessionId"] as string,
            obj["view"] === undefined || obj["view"] === null ? undefined : obj["view"] === undefined || obj["view"] === null ? undefined : ContentView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["view"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_GetSession_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_GetSession_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#GetSession'
    public baboonTypeIdentifier() {
        return Operation_GetSession_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_GetSession_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_GetSession_JsonCodec())
    public static get instance(): Operation_GetSession_JsonCodec {
        return Operation_GetSession_JsonCodec.lazyInstance.value
    }
}

export class Operation_GetChunks implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#GetChunks' as const;
    private readonly _sessionId: string;
    private readonly _offset: number;
    private readonly _limit: number;
    private readonly _view: ContentView | undefined;

    constructor(sessionId: string, offset: number, limit: number, view: ContentView | undefined) {
        this._sessionId = sessionId
        this._offset = offset
        this._limit = limit
        this._view = view
    }

    public get sessionId(): string {
        return this._sessionId;
    }
    public get offset(): number {
        return this._offset;
    }
    public get limit(): number {
        return this._limit;
    }
    public get view(): ContentView | undefined {
        return this._view;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sessionId: this._sessionId,
            offset: this._offset,
            limit: this._limit,
            view: this._view !== undefined ? this._view : undefined
        };
    }

    public with(overrides: {sessionId?: string; offset?: number; limit?: number; view?: ContentView | undefined}): Operation_GetChunks {
        return new Operation_GetChunks(
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId,
            'offset' in overrides ? overrides.offset! : this._offset,
            'limit' in overrides ? overrides.limit! : this._limit,
            'view' in overrides ? overrides.view! : this._view
        );
    }

    public static fromPlain(obj: {sessionId: string; offset: number; limit: number; view: ContentView | undefined}): Operation_GetChunks {
        return new Operation_GetChunks(
            obj.sessionId,
            obj.offset,
            obj.limit,
            obj.view
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_GetChunks.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_GetChunks.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#GetChunks'
    public baboonTypeIdentifier() {
        return Operation_GetChunks.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_GetChunks.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_GetChunks.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_GetChunks.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_GetChunks.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_GetChunks_JsonCodec {
        return Operation_GetChunks_JsonCodec.instance
    }
}

export class Operation_GetChunks_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_GetChunks): unknown {
        if (this !== Operation_GetChunks_JsonCodec.lazyInstance.value) {
          return Operation_GetChunks_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sessionId": value.sessionId,
            "offset": value.offset,
            "limit": value.limit,
            "view": value.view === undefined ? null : ContentView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.view),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_GetChunks {
        if (this !== Operation_GetChunks_JsonCodec .lazyInstance.value) {
            return Operation_GetChunks_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_GetChunks (
            obj["sessionId"] as string,
            obj["offset"] as number,
            obj["limit"] as number,
            obj["view"] === undefined || obj["view"] === null ? undefined : obj["view"] === undefined || obj["view"] === null ? undefined : ContentView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["view"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_GetChunks_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_GetChunks_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#GetChunks'
    public baboonTypeIdentifier() {
        return Operation_GetChunks_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_GetChunks_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_GetChunks_JsonCodec())
    public static get instance(): Operation_GetChunks_JsonCodec {
        return Operation_GetChunks_JsonCodec.lazyInstance.value
    }
}

export class Operation_GetMessages implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#GetMessages' as const;
    private readonly _sessionId: string;
    private readonly _offset: number;
    private readonly _limit: number;
    private readonly _view: ContentView | undefined;

    constructor(sessionId: string, offset: number, limit: number, view: ContentView | undefined) {
        this._sessionId = sessionId
        this._offset = offset
        this._limit = limit
        this._view = view
    }

    public get sessionId(): string {
        return this._sessionId;
    }
    public get offset(): number {
        return this._offset;
    }
    public get limit(): number {
        return this._limit;
    }
    public get view(): ContentView | undefined {
        return this._view;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sessionId: this._sessionId,
            offset: this._offset,
            limit: this._limit,
            view: this._view !== undefined ? this._view : undefined
        };
    }

    public with(overrides: {sessionId?: string; offset?: number; limit?: number; view?: ContentView | undefined}): Operation_GetMessages {
        return new Operation_GetMessages(
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId,
            'offset' in overrides ? overrides.offset! : this._offset,
            'limit' in overrides ? overrides.limit! : this._limit,
            'view' in overrides ? overrides.view! : this._view
        );
    }

    public static fromPlain(obj: {sessionId: string; offset: number; limit: number; view: ContentView | undefined}): Operation_GetMessages {
        return new Operation_GetMessages(
            obj.sessionId,
            obj.offset,
            obj.limit,
            obj.view
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_GetMessages.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_GetMessages.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#GetMessages'
    public baboonTypeIdentifier() {
        return Operation_GetMessages.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_GetMessages.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_GetMessages.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_GetMessages.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_GetMessages.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_GetMessages_JsonCodec {
        return Operation_GetMessages_JsonCodec.instance
    }
}

export class Operation_GetMessages_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_GetMessages): unknown {
        if (this !== Operation_GetMessages_JsonCodec.lazyInstance.value) {
          return Operation_GetMessages_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sessionId": value.sessionId,
            "offset": value.offset,
            "limit": value.limit,
            "view": value.view === undefined ? null : ContentView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.view),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_GetMessages {
        if (this !== Operation_GetMessages_JsonCodec .lazyInstance.value) {
            return Operation_GetMessages_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_GetMessages (
            obj["sessionId"] as string,
            obj["offset"] as number,
            obj["limit"] as number,
            obj["view"] === undefined || obj["view"] === null ? undefined : obj["view"] === undefined || obj["view"] === null ? undefined : ContentView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["view"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_GetMessages_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_GetMessages_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#GetMessages'
    public baboonTypeIdentifier() {
        return Operation_GetMessages_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_GetMessages_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_GetMessages_JsonCodec())
    public static get instance(): Operation_GetMessages_JsonCodec {
        return Operation_GetMessages_JsonCodec.lazyInstance.value
    }
}

export class Operation_GetRaw implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#GetRaw' as const;
    private readonly _sessionId: string;
    private readonly _revision: number | undefined;

    constructor(sessionId: string, revision: number | undefined) {
        this._sessionId = sessionId
        this._revision = revision
    }

    public get sessionId(): string {
        return this._sessionId;
    }
    public get revision(): number | undefined {
        return this._revision;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sessionId: this._sessionId,
            revision: this._revision !== undefined ? this._revision : undefined
        };
    }

    public with(overrides: {sessionId?: string; revision?: number | undefined}): Operation_GetRaw {
        return new Operation_GetRaw(
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId,
            'revision' in overrides ? overrides.revision! : this._revision
        );
    }

    public static fromPlain(obj: {sessionId: string; revision: number | undefined}): Operation_GetRaw {
        return new Operation_GetRaw(
            obj.sessionId,
            obj.revision
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_GetRaw.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_GetRaw.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#GetRaw'
    public baboonTypeIdentifier() {
        return Operation_GetRaw.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_GetRaw.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_GetRaw.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_GetRaw.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_GetRaw.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_GetRaw_JsonCodec {
        return Operation_GetRaw_JsonCodec.instance
    }
}

export class Operation_GetRaw_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_GetRaw): unknown {
        if (this !== Operation_GetRaw_JsonCodec.lazyInstance.value) {
          return Operation_GetRaw_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sessionId": value.sessionId,
            "revision": value.revision === undefined ? null : value.revision,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_GetRaw {
        if (this !== Operation_GetRaw_JsonCodec .lazyInstance.value) {
            return Operation_GetRaw_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_GetRaw (
            obj["sessionId"] as string,
            obj["revision"] === undefined || obj["revision"] === null ? undefined : obj["revision"] === undefined || obj["revision"] === null ? undefined : obj["revision"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_GetRaw_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_GetRaw_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#GetRaw'
    public baboonTypeIdentifier() {
        return Operation_GetRaw_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_GetRaw_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_GetRaw_JsonCodec())
    public static get instance(): Operation_GetRaw_JsonCodec {
        return Operation_GetRaw_JsonCodec.lazyInstance.value
    }
}

export class Operation_Related implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#Related' as const;
    private readonly _sessionId: string;
    private readonly _limit: number;

    constructor(sessionId: string, limit: number) {
        this._sessionId = sessionId
        this._limit = limit
    }

    public get sessionId(): string {
        return this._sessionId;
    }
    public get limit(): number {
        return this._limit;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sessionId: this._sessionId,
            limit: this._limit
        };
    }

    public with(overrides: {sessionId?: string; limit?: number}): Operation_Related {
        return new Operation_Related(
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId,
            'limit' in overrides ? overrides.limit! : this._limit
        );
    }

    public static fromPlain(obj: {sessionId: string; limit: number}): Operation_Related {
        return new Operation_Related(
            obj.sessionId,
            obj.limit
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Related.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Related.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Related'
    public baboonTypeIdentifier() {
        return Operation_Related.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_Related.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Related.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_Related.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Related.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Related_JsonCodec {
        return Operation_Related_JsonCodec.instance
    }
}

export class Operation_Related_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Related): unknown {
        if (this !== Operation_Related_JsonCodec.lazyInstance.value) {
          return Operation_Related_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sessionId": value.sessionId,
            "limit": value.limit,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Related {
        if (this !== Operation_Related_JsonCodec .lazyInstance.value) {
            return Operation_Related_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Related (
            obj["sessionId"] as string,
            obj["limit"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Related_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Related_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Related'
    public baboonTypeIdentifier() {
        return Operation_Related_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Related_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Related_JsonCodec())
    public static get instance(): Operation_Related_JsonCodec {
        return Operation_Related_JsonCodec.lazyInstance.value
    }
}

export class Operation_Facets implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#Facets' as const;
    private readonly _filter: SearchFilter;

    constructor(filter: SearchFilter) {
        this._filter = filter
    }

    public get filter(): SearchFilter {
        return this._filter;
    }

    public toJSON(): Record<string, unknown> {
        return {
            filter: this._filter
        };
    }

    public with(overrides: {filter?: SearchFilter}): Operation_Facets {
        return new Operation_Facets(
            'filter' in overrides ? overrides.filter! : this._filter
        );
    }

    public static fromPlain(obj: {filter: SearchFilter}): Operation_Facets {
        return new Operation_Facets(
            obj.filter
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Facets.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Facets.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Facets'
    public baboonTypeIdentifier() {
        return Operation_Facets.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_Facets.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Facets.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_Facets.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Facets.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Facets_JsonCodec {
        return Operation_Facets_JsonCodec.instance
    }
}

export class Operation_Facets_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Facets): unknown {
        if (this !== Operation_Facets_JsonCodec.lazyInstance.value) {
          return Operation_Facets_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "filter": SearchFilter_JsonCodec.instance.encode(BaboonCodecContext.Default, value.filter),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Facets {
        if (this !== Operation_Facets_JsonCodec .lazyInstance.value) {
            return Operation_Facets_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Facets (
            SearchFilter_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["filter"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Facets_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Facets_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Facets'
    public baboonTypeIdentifier() {
        return Operation_Facets_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Facets_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Facets_JsonCodec())
    public static get instance(): Operation_Facets_JsonCodec {
        return Operation_Facets_JsonCodec.lazyInstance.value
    }
}

export class Operation_CollectionStatus implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#CollectionStatus' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): Operation_CollectionStatus {
        return new Operation_CollectionStatus(
            
        );
    }

    public static fromPlain(obj: {}): Operation_CollectionStatus {
        return new Operation_CollectionStatus(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_CollectionStatus.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_CollectionStatus.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#CollectionStatus'
    public baboonTypeIdentifier() {
        return Operation_CollectionStatus.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_CollectionStatus.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_CollectionStatus.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.2.0", "prefix-compact": "1.2.0", "prefix-any-mode": "1.2.0", "identical": "1.2.0" }
    public baboonMinReaderVersions() {
        return Operation_CollectionStatus.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_CollectionStatus.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_CollectionStatus_JsonCodec {
        return Operation_CollectionStatus_JsonCodec.instance
    }
}

export class Operation_CollectionStatus_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_CollectionStatus): unknown {
        if (this !== Operation_CollectionStatus_JsonCodec.lazyInstance.value) {
          return Operation_CollectionStatus_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_CollectionStatus {
        if (this !== Operation_CollectionStatus_JsonCodec .lazyInstance.value) {
            return Operation_CollectionStatus_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_CollectionStatus (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_CollectionStatus_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_CollectionStatus_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#CollectionStatus'
    public baboonTypeIdentifier() {
        return Operation_CollectionStatus_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_CollectionStatus_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_CollectionStatus_JsonCodec())
    public static get instance(): Operation_CollectionStatus_JsonCodec {
        return Operation_CollectionStatus_JsonCodec.lazyInstance.value
    }
}

export class Operation_IngestStatus implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#IngestStatus' as const;
    private readonly _offset: number;
    private readonly _limit: number;

    constructor(offset: number, limit: number) {
        this._offset = offset
        this._limit = limit
    }

    public get offset(): number {
        return this._offset;
    }
    public get limit(): number {
        return this._limit;
    }

    public toJSON(): Record<string, unknown> {
        return {
            offset: this._offset,
            limit: this._limit
        };
    }

    public with(overrides: {offset?: number; limit?: number}): Operation_IngestStatus {
        return new Operation_IngestStatus(
            'offset' in overrides ? overrides.offset! : this._offset,
            'limit' in overrides ? overrides.limit! : this._limit
        );
    }

    public static fromPlain(obj: {offset: number; limit: number}): Operation_IngestStatus {
        return new Operation_IngestStatus(
            obj.offset,
            obj.limit
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_IngestStatus.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_IngestStatus.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#IngestStatus'
    public baboonTypeIdentifier() {
        return Operation_IngestStatus.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_IngestStatus.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_IngestStatus.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_IngestStatus.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_IngestStatus.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_IngestStatus_JsonCodec {
        return Operation_IngestStatus_JsonCodec.instance
    }
}

export class Operation_IngestStatus_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_IngestStatus): unknown {
        if (this !== Operation_IngestStatus_JsonCodec.lazyInstance.value) {
          return Operation_IngestStatus_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "offset": value.offset,
            "limit": value.limit,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_IngestStatus {
        if (this !== Operation_IngestStatus_JsonCodec .lazyInstance.value) {
            return Operation_IngestStatus_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_IngestStatus (
            obj["offset"] as number,
            obj["limit"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_IngestStatus_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_IngestStatus_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#IngestStatus'
    public baboonTypeIdentifier() {
        return Operation_IngestStatus_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_IngestStatus_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_IngestStatus_JsonCodec())
    public static get instance(): Operation_IngestStatus_JsonCodec {
        return Operation_IngestStatus_JsonCodec.lazyInstance.value
    }
}

export class Operation_RetryJob implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#RetryJob' as const;
    private readonly _jobId: string;

    constructor(jobId: string) {
        this._jobId = jobId
    }

    public get jobId(): string {
        return this._jobId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            jobId: this._jobId
        };
    }

    public with(overrides: {jobId?: string}): Operation_RetryJob {
        return new Operation_RetryJob(
            'jobId' in overrides ? overrides.jobId! : this._jobId
        );
    }

    public static fromPlain(obj: {jobId: string}): Operation_RetryJob {
        return new Operation_RetryJob(
            obj.jobId
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_RetryJob.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_RetryJob.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#RetryJob'
    public baboonTypeIdentifier() {
        return Operation_RetryJob.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_RetryJob.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_RetryJob.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_RetryJob.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_RetryJob.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_RetryJob_JsonCodec {
        return Operation_RetryJob_JsonCodec.instance
    }
}

export class Operation_RetryJob_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_RetryJob): unknown {
        if (this !== Operation_RetryJob_JsonCodec.lazyInstance.value) {
          return Operation_RetryJob_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "jobId": value.jobId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_RetryJob {
        if (this !== Operation_RetryJob_JsonCodec .lazyInstance.value) {
            return Operation_RetryJob_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_RetryJob (
            obj["jobId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_RetryJob_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_RetryJob_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#RetryJob'
    public baboonTypeIdentifier() {
        return Operation_RetryJob_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_RetryJob_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_RetryJob_JsonCodec())
    public static get instance(): Operation_RetryJob_JsonCodec {
        return Operation_RetryJob_JsonCodec.lazyInstance.value
    }
}

export class Operation_ListTokens implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#ListTokens' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): Operation_ListTokens {
        return new Operation_ListTokens(
            
        );
    }

    public static fromPlain(obj: {}): Operation_ListTokens {
        return new Operation_ListTokens(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_ListTokens.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_ListTokens.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#ListTokens'
    public baboonTypeIdentifier() {
        return Operation_ListTokens.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_ListTokens.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_ListTokens.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_ListTokens.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_ListTokens.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_ListTokens_JsonCodec {
        return Operation_ListTokens_JsonCodec.instance
    }
}

export class Operation_ListTokens_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_ListTokens): unknown {
        if (this !== Operation_ListTokens_JsonCodec.lazyInstance.value) {
          return Operation_ListTokens_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_ListTokens {
        if (this !== Operation_ListTokens_JsonCodec .lazyInstance.value) {
            return Operation_ListTokens_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_ListTokens (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_ListTokens_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_ListTokens_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#ListTokens'
    public baboonTypeIdentifier() {
        return Operation_ListTokens_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_ListTokens_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_ListTokens_JsonCodec())
    public static get instance(): Operation_ListTokens_JsonCodec {
        return Operation_ListTokens_JsonCodec.lazyInstance.value
    }
}

export class Operation_MintToken implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#MintToken' as const;
    private readonly _name: string;
    private readonly _scopes: Array<Scope>;

    constructor(name: string, scopes: Array<Scope>) {
        this._name = name
        this._scopes = scopes
    }

    public get name(): string {
        return this._name;
    }
    public get scopes(): Array<Scope> {
        return this._scopes;
    }

    public toJSON(): Record<string, unknown> {
        return {
            name: this._name,
            scopes: this._scopes
        };
    }

    public with(overrides: {name?: string; scopes?: Array<Scope>}): Operation_MintToken {
        return new Operation_MintToken(
            'name' in overrides ? overrides.name! : this._name,
            'scopes' in overrides ? overrides.scopes! : this._scopes
        );
    }

    public static fromPlain(obj: {name: string; scopes: Array<Scope>}): Operation_MintToken {
        return new Operation_MintToken(
            obj.name,
            obj.scopes
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_MintToken.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_MintToken.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#MintToken'
    public baboonTypeIdentifier() {
        return Operation_MintToken.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_MintToken.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_MintToken.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_MintToken.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_MintToken.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_MintToken_JsonCodec {
        return Operation_MintToken_JsonCodec.instance
    }
}

export class Operation_MintToken_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_MintToken): unknown {
        if (this !== Operation_MintToken_JsonCodec.lazyInstance.value) {
          return Operation_MintToken_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "name": value.name,
            "scopes": Array.from(value.scopes).map(item => Scope_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_MintToken {
        if (this !== Operation_MintToken_JsonCodec .lazyInstance.value) {
            return Operation_MintToken_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_MintToken (
            obj["name"] as string,
            (obj["scopes"] as unknown[]).map(item => Scope_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_MintToken_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_MintToken_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#MintToken'
    public baboonTypeIdentifier() {
        return Operation_MintToken_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_MintToken_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_MintToken_JsonCodec())
    public static get instance(): Operation_MintToken_JsonCodec {
        return Operation_MintToken_JsonCodec.lazyInstance.value
    }
}

export class Operation_RevokeToken implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#RevokeToken' as const;
    private readonly _tokenId: string;

    constructor(tokenId: string) {
        this._tokenId = tokenId
    }

    public get tokenId(): string {
        return this._tokenId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            tokenId: this._tokenId
        };
    }

    public with(overrides: {tokenId?: string}): Operation_RevokeToken {
        return new Operation_RevokeToken(
            'tokenId' in overrides ? overrides.tokenId! : this._tokenId
        );
    }

    public static fromPlain(obj: {tokenId: string}): Operation_RevokeToken {
        return new Operation_RevokeToken(
            obj.tokenId
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_RevokeToken.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_RevokeToken.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#RevokeToken'
    public baboonTypeIdentifier() {
        return Operation_RevokeToken.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_RevokeToken.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_RevokeToken.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_RevokeToken.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_RevokeToken.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_RevokeToken_JsonCodec {
        return Operation_RevokeToken_JsonCodec.instance
    }
}

export class Operation_RevokeToken_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_RevokeToken): unknown {
        if (this !== Operation_RevokeToken_JsonCodec.lazyInstance.value) {
          return Operation_RevokeToken_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "tokenId": value.tokenId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_RevokeToken {
        if (this !== Operation_RevokeToken_JsonCodec .lazyInstance.value) {
            return Operation_RevokeToken_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_RevokeToken (
            obj["tokenId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_RevokeToken_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_RevokeToken_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#RevokeToken'
    public baboonTypeIdentifier() {
        return Operation_RevokeToken_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_RevokeToken_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_RevokeToken_JsonCodec())
    public static get instance(): Operation_RevokeToken_JsonCodec {
        return Operation_RevokeToken_JsonCodec.lazyInstance.value
    }
}

export class Operation_ListGroups implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#ListGroups' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): Operation_ListGroups {
        return new Operation_ListGroups(
            
        );
    }

    public static fromPlain(obj: {}): Operation_ListGroups {
        return new Operation_ListGroups(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_ListGroups.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_ListGroups.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#ListGroups'
    public baboonTypeIdentifier() {
        return Operation_ListGroups.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_ListGroups.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_ListGroups.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_ListGroups.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_ListGroups.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_ListGroups_JsonCodec {
        return Operation_ListGroups_JsonCodec.instance
    }
}

export class Operation_ListGroups_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_ListGroups): unknown {
        if (this !== Operation_ListGroups_JsonCodec.lazyInstance.value) {
          return Operation_ListGroups_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_ListGroups {
        if (this !== Operation_ListGroups_JsonCodec .lazyInstance.value) {
            return Operation_ListGroups_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_ListGroups (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_ListGroups_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_ListGroups_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#ListGroups'
    public baboonTypeIdentifier() {
        return Operation_ListGroups_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_ListGroups_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_ListGroups_JsonCodec())
    public static get instance(): Operation_ListGroups_JsonCodec {
        return Operation_ListGroups_JsonCodec.lazyInstance.value
    }
}

export class Operation_CreateGroup implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#CreateGroup' as const;
    private readonly _name: string;

    constructor(name: string) {
        this._name = name
    }

    public get name(): string {
        return this._name;
    }

    public toJSON(): Record<string, unknown> {
        return {
            name: this._name
        };
    }

    public with(overrides: {name?: string}): Operation_CreateGroup {
        return new Operation_CreateGroup(
            'name' in overrides ? overrides.name! : this._name
        );
    }

    public static fromPlain(obj: {name: string}): Operation_CreateGroup {
        return new Operation_CreateGroup(
            obj.name
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_CreateGroup.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_CreateGroup.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#CreateGroup'
    public baboonTypeIdentifier() {
        return Operation_CreateGroup.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_CreateGroup.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_CreateGroup.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_CreateGroup.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_CreateGroup.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_CreateGroup_JsonCodec {
        return Operation_CreateGroup_JsonCodec.instance
    }
}

export class Operation_CreateGroup_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_CreateGroup): unknown {
        if (this !== Operation_CreateGroup_JsonCodec.lazyInstance.value) {
          return Operation_CreateGroup_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "name": value.name,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_CreateGroup {
        if (this !== Operation_CreateGroup_JsonCodec .lazyInstance.value) {
            return Operation_CreateGroup_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_CreateGroup (
            obj["name"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_CreateGroup_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_CreateGroup_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#CreateGroup'
    public baboonTypeIdentifier() {
        return Operation_CreateGroup_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_CreateGroup_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_CreateGroup_JsonCodec())
    public static get instance(): Operation_CreateGroup_JsonCodec {
        return Operation_CreateGroup_JsonCodec.lazyInstance.value
    }
}

export class Operation_Invite implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#Invite' as const;
    private readonly _groupId: string;
    private readonly _targetId: string;

    constructor(groupId: string, targetId: string) {
        this._groupId = groupId
        this._targetId = targetId
    }

    public get groupId(): string {
        return this._groupId;
    }
    public get targetId(): string {
        return this._targetId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            groupId: this._groupId,
            targetId: this._targetId
        };
    }

    public with(overrides: {groupId?: string; targetId?: string}): Operation_Invite {
        return new Operation_Invite(
            'groupId' in overrides ? overrides.groupId! : this._groupId,
            'targetId' in overrides ? overrides.targetId! : this._targetId
        );
    }

    public static fromPlain(obj: {groupId: string; targetId: string}): Operation_Invite {
        return new Operation_Invite(
            obj.groupId,
            obj.targetId
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Invite.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Invite.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Invite'
    public baboonTypeIdentifier() {
        return Operation_Invite.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_Invite.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Invite.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_Invite.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Invite.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Invite_JsonCodec {
        return Operation_Invite_JsonCodec.instance
    }
}

export class Operation_Invite_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Invite): unknown {
        if (this !== Operation_Invite_JsonCodec.lazyInstance.value) {
          return Operation_Invite_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "groupId": value.groupId,
            "targetId": value.targetId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Invite {
        if (this !== Operation_Invite_JsonCodec .lazyInstance.value) {
            return Operation_Invite_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Invite (
            obj["groupId"] as string,
            obj["targetId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Invite_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Invite_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Invite'
    public baboonTypeIdentifier() {
        return Operation_Invite_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Invite_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Invite_JsonCodec())
    public static get instance(): Operation_Invite_JsonCodec {
        return Operation_Invite_JsonCodec.lazyInstance.value
    }
}

export class Operation_AcceptInvite implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#AcceptInvite' as const;
    private readonly _invitationId: string;
    private readonly _confirmSharing: boolean;

    constructor(invitationId: string, confirmSharing: boolean) {
        this._invitationId = invitationId
        this._confirmSharing = confirmSharing
    }

    public get invitationId(): string {
        return this._invitationId;
    }
    public get confirmSharing(): boolean {
        return this._confirmSharing;
    }

    public toJSON(): Record<string, unknown> {
        return {
            invitationId: this._invitationId,
            confirmSharing: this._confirmSharing
        };
    }

    public with(overrides: {invitationId?: string; confirmSharing?: boolean}): Operation_AcceptInvite {
        return new Operation_AcceptInvite(
            'invitationId' in overrides ? overrides.invitationId! : this._invitationId,
            'confirmSharing' in overrides ? overrides.confirmSharing! : this._confirmSharing
        );
    }

    public static fromPlain(obj: {invitationId: string; confirmSharing: boolean}): Operation_AcceptInvite {
        return new Operation_AcceptInvite(
            obj.invitationId,
            obj.confirmSharing
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_AcceptInvite.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_AcceptInvite.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#AcceptInvite'
    public baboonTypeIdentifier() {
        return Operation_AcceptInvite.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_AcceptInvite.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_AcceptInvite.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_AcceptInvite.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_AcceptInvite.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_AcceptInvite_JsonCodec {
        return Operation_AcceptInvite_JsonCodec.instance
    }
}

export class Operation_AcceptInvite_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_AcceptInvite): unknown {
        if (this !== Operation_AcceptInvite_JsonCodec.lazyInstance.value) {
          return Operation_AcceptInvite_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "invitationId": value.invitationId,
            "confirmSharing": value.confirmSharing,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_AcceptInvite {
        if (this !== Operation_AcceptInvite_JsonCodec .lazyInstance.value) {
            return Operation_AcceptInvite_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_AcceptInvite (
            obj["invitationId"] as string,
            obj["confirmSharing"] as boolean,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_AcceptInvite_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_AcceptInvite_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#AcceptInvite'
    public baboonTypeIdentifier() {
        return Operation_AcceptInvite_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_AcceptInvite_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_AcceptInvite_JsonCodec())
    public static get instance(): Operation_AcceptInvite_JsonCodec {
        return Operation_AcceptInvite_JsonCodec.lazyInstance.value
    }
}

export class Operation_RemoveMember implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#RemoveMember' as const;
    private readonly _groupId: string;
    private readonly _userId: string;

    constructor(groupId: string, userId: string) {
        this._groupId = groupId
        this._userId = userId
    }

    public get groupId(): string {
        return this._groupId;
    }
    public get userId(): string {
        return this._userId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            groupId: this._groupId,
            userId: this._userId
        };
    }

    public with(overrides: {groupId?: string; userId?: string}): Operation_RemoveMember {
        return new Operation_RemoveMember(
            'groupId' in overrides ? overrides.groupId! : this._groupId,
            'userId' in overrides ? overrides.userId! : this._userId
        );
    }

    public static fromPlain(obj: {groupId: string; userId: string}): Operation_RemoveMember {
        return new Operation_RemoveMember(
            obj.groupId,
            obj.userId
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_RemoveMember.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_RemoveMember.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#RemoveMember'
    public baboonTypeIdentifier() {
        return Operation_RemoveMember.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_RemoveMember.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_RemoveMember.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_RemoveMember.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_RemoveMember.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_RemoveMember_JsonCodec {
        return Operation_RemoveMember_JsonCodec.instance
    }
}

export class Operation_RemoveMember_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_RemoveMember): unknown {
        if (this !== Operation_RemoveMember_JsonCodec.lazyInstance.value) {
          return Operation_RemoveMember_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "groupId": value.groupId,
            "userId": value.userId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_RemoveMember {
        if (this !== Operation_RemoveMember_JsonCodec .lazyInstance.value) {
            return Operation_RemoveMember_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_RemoveMember (
            obj["groupId"] as string,
            obj["userId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_RemoveMember_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_RemoveMember_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#RemoveMember'
    public baboonTypeIdentifier() {
        return Operation_RemoveMember_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_RemoveMember_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_RemoveMember_JsonCodec())
    public static get instance(): Operation_RemoveMember_JsonCodec {
        return Operation_RemoveMember_JsonCodec.lazyInstance.value
    }
}

export class Operation_LeaveGroup implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#LeaveGroup' as const;
    private readonly _groupId: string;

    constructor(groupId: string) {
        this._groupId = groupId
    }

    public get groupId(): string {
        return this._groupId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            groupId: this._groupId
        };
    }

    public with(overrides: {groupId?: string}): Operation_LeaveGroup {
        return new Operation_LeaveGroup(
            'groupId' in overrides ? overrides.groupId! : this._groupId
        );
    }

    public static fromPlain(obj: {groupId: string}): Operation_LeaveGroup {
        return new Operation_LeaveGroup(
            obj.groupId
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_LeaveGroup.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_LeaveGroup.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#LeaveGroup'
    public baboonTypeIdentifier() {
        return Operation_LeaveGroup.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_LeaveGroup.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_LeaveGroup.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_LeaveGroup.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_LeaveGroup.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_LeaveGroup_JsonCodec {
        return Operation_LeaveGroup_JsonCodec.instance
    }
}

export class Operation_LeaveGroup_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_LeaveGroup): unknown {
        if (this !== Operation_LeaveGroup_JsonCodec.lazyInstance.value) {
          return Operation_LeaveGroup_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "groupId": value.groupId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_LeaveGroup {
        if (this !== Operation_LeaveGroup_JsonCodec .lazyInstance.value) {
            return Operation_LeaveGroup_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_LeaveGroup (
            obj["groupId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_LeaveGroup_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_LeaveGroup_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#LeaveGroup'
    public baboonTypeIdentifier() {
        return Operation_LeaveGroup_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_LeaveGroup_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_LeaveGroup_JsonCodec())
    public static get instance(): Operation_LeaveGroup_JsonCodec {
        return Operation_LeaveGroup_JsonCodec.lazyInstance.value
    }
}

export class Operation_DeleteGroup implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#DeleteGroup' as const;
    private readonly _groupId: string;

    constructor(groupId: string) {
        this._groupId = groupId
    }

    public get groupId(): string {
        return this._groupId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            groupId: this._groupId
        };
    }

    public with(overrides: {groupId?: string}): Operation_DeleteGroup {
        return new Operation_DeleteGroup(
            'groupId' in overrides ? overrides.groupId! : this._groupId
        );
    }

    public static fromPlain(obj: {groupId: string}): Operation_DeleteGroup {
        return new Operation_DeleteGroup(
            obj.groupId
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_DeleteGroup.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_DeleteGroup.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#DeleteGroup'
    public baboonTypeIdentifier() {
        return Operation_DeleteGroup.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_DeleteGroup.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_DeleteGroup.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_DeleteGroup.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_DeleteGroup.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_DeleteGroup_JsonCodec {
        return Operation_DeleteGroup_JsonCodec.instance
    }
}

export class Operation_DeleteGroup_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_DeleteGroup): unknown {
        if (this !== Operation_DeleteGroup_JsonCodec.lazyInstance.value) {
          return Operation_DeleteGroup_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "groupId": value.groupId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_DeleteGroup {
        if (this !== Operation_DeleteGroup_JsonCodec .lazyInstance.value) {
            return Operation_DeleteGroup_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_DeleteGroup (
            obj["groupId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_DeleteGroup_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_DeleteGroup_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#DeleteGroup'
    public baboonTypeIdentifier() {
        return Operation_DeleteGroup_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_DeleteGroup_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_DeleteGroup_JsonCodec())
    public static get instance(): Operation_DeleteGroup_JsonCodec {
        return Operation_DeleteGroup_JsonCodec.lazyInstance.value
    }
}

export class Operation_Receipt implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#Receipt' as const;
    private readonly _mutationId: string;

    constructor(mutationId: string) {
        this._mutationId = mutationId
    }

    public get mutationId(): string {
        return this._mutationId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            mutationId: this._mutationId
        };
    }

    public with(overrides: {mutationId?: string}): Operation_Receipt {
        return new Operation_Receipt(
            'mutationId' in overrides ? overrides.mutationId! : this._mutationId
        );
    }

    public static fromPlain(obj: {mutationId: string}): Operation_Receipt {
        return new Operation_Receipt(
            obj.mutationId
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Receipt.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Receipt.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Receipt'
    public baboonTypeIdentifier() {
        return Operation_Receipt.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_Receipt.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Receipt.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_Receipt.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Receipt.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Receipt_JsonCodec {
        return Operation_Receipt_JsonCodec.instance
    }
}

export class Operation_Receipt_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Receipt): unknown {
        if (this !== Operation_Receipt_JsonCodec.lazyInstance.value) {
          return Operation_Receipt_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "mutationId": value.mutationId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Receipt {
        if (this !== Operation_Receipt_JsonCodec .lazyInstance.value) {
            return Operation_Receipt_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Receipt (
            obj["mutationId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Receipt_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Receipt_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Receipt'
    public baboonTypeIdentifier() {
        return Operation_Receipt_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Receipt_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Receipt_JsonCodec())
    public static get instance(): Operation_Receipt_JsonCodec {
        return Operation_Receipt_JsonCodec.lazyInstance.value
    }
}

export class Operation_Purge implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#Purge' as const;
    private readonly _sessionId: string;

    constructor(sessionId: string) {
        this._sessionId = sessionId
    }

    public get sessionId(): string {
        return this._sessionId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sessionId: this._sessionId
        };
    }

    public with(overrides: {sessionId?: string}): Operation_Purge {
        return new Operation_Purge(
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId
        );
    }

    public static fromPlain(obj: {sessionId: string}): Operation_Purge {
        return new Operation_Purge(
            obj.sessionId
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Purge.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Purge.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Purge'
    public baboonTypeIdentifier() {
        return Operation_Purge.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_Purge.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Purge.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_Purge.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Purge.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Purge_JsonCodec {
        return Operation_Purge_JsonCodec.instance
    }
}

export class Operation_Purge_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Purge): unknown {
        if (this !== Operation_Purge_JsonCodec.lazyInstance.value) {
          return Operation_Purge_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sessionId": value.sessionId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Purge {
        if (this !== Operation_Purge_JsonCodec .lazyInstance.value) {
            return Operation_Purge_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Purge (
            obj["sessionId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Purge_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Purge_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Purge'
    public baboonTypeIdentifier() {
        return Operation_Purge_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Purge_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Purge_JsonCodec())
    public static get instance(): Operation_Purge_JsonCodec {
        return Operation_Purge_JsonCodec.lazyInstance.value
    }
}

export class Operation_Logout implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#Logout' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): Operation_Logout {
        return new Operation_Logout(
            
        );
    }

    public static fromPlain(obj: {}): Operation_Logout {
        return new Operation_Logout(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Logout.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Logout.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Logout'
    public baboonTypeIdentifier() {
        return Operation_Logout.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return Operation_Logout.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Logout.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Operation_Logout.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Logout.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Logout_JsonCodec {
        return Operation_Logout_JsonCodec.instance
    }
}

export class Operation_Logout_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Logout): unknown {
        if (this !== Operation_Logout_JsonCodec.lazyInstance.value) {
          return Operation_Logout_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Logout {
        if (this !== Operation_Logout_JsonCodec .lazyInstance.value) {
            return Operation_Logout_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Logout (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Logout_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Logout_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Logout'
    public baboonTypeIdentifier() {
        return Operation_Logout_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Logout_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Logout_JsonCodec())
    public static get instance(): Operation_Logout_JsonCodec {
        return Operation_Logout_JsonCodec.lazyInstance.value
    }
}

export class Operation_Archive implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#Archive' as const;
    private readonly _query: ArchiveQuery;

    constructor(query: ArchiveQuery) {
        this._query = query
    }

    public get query(): ArchiveQuery {
        return this._query;
    }

    public toJSON(): Record<string, unknown> {
        return {
            query: this._query
        };
    }

    public with(overrides: {query?: ArchiveQuery}): Operation_Archive {
        return new Operation_Archive(
            'query' in overrides ? overrides.query! : this._query
        );
    }

    public static fromPlain(obj: {query: ArchiveQuery}): Operation_Archive {
        return new Operation_Archive(
            obj.query
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Archive.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Archive.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Archive'
    public baboonTypeIdentifier() {
        return Operation_Archive.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0"]
    public baboonSameInVersions() {
        return Operation_Archive.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Archive.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return Operation_Archive.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Archive.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Archive_JsonCodec {
        return Operation_Archive_JsonCodec.instance
    }
}

export class Operation_Archive_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Archive): unknown {
        if (this !== Operation_Archive_JsonCodec.lazyInstance.value) {
          return Operation_Archive_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "query": ArchiveQuery_JsonCodec.instance.encode(BaboonCodecContext.Default, value.query),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Archive {
        if (this !== Operation_Archive_JsonCodec .lazyInstance.value) {
            return Operation_Archive_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Archive (
            ArchiveQuery_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["query"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Archive_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Archive_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Archive'
    public baboonTypeIdentifier() {
        return Operation_Archive_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Archive_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Archive_JsonCodec())
    public static get instance(): Operation_Archive_JsonCodec {
        return Operation_Archive_JsonCodec.lazyInstance.value
    }
}

export class Operation_Activity implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#Activity' as const;
    private readonly _query: ActivityQuery;

    constructor(query: ActivityQuery) {
        this._query = query
    }

    public get query(): ActivityQuery {
        return this._query;
    }

    public toJSON(): Record<string, unknown> {
        return {
            query: this._query
        };
    }

    public with(overrides: {query?: ActivityQuery}): Operation_Activity {
        return new Operation_Activity(
            'query' in overrides ? overrides.query! : this._query
        );
    }

    public static fromPlain(obj: {query: ActivityQuery}): Operation_Activity {
        return new Operation_Activity(
            obj.query
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Activity.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Activity.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Activity'
    public baboonTypeIdentifier() {
        return Operation_Activity.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0"]
    public baboonSameInVersions() {
        return Operation_Activity.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Activity.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return Operation_Activity.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Activity.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Activity_JsonCodec {
        return Operation_Activity_JsonCodec.instance
    }
}

export class Operation_Activity_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Activity): unknown {
        if (this !== Operation_Activity_JsonCodec.lazyInstance.value) {
          return Operation_Activity_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "query": ActivityQuery_JsonCodec.instance.encode(BaboonCodecContext.Default, value.query),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Activity {
        if (this !== Operation_Activity_JsonCodec .lazyInstance.value) {
            return Operation_Activity_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Activity (
            ActivityQuery_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["query"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_Activity_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_Activity_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#Activity'
    public baboonTypeIdentifier() {
        return Operation_Activity_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Activity_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Activity_JsonCodec())
    public static get instance(): Operation_Activity_JsonCodec {
        return Operation_Activity_JsonCodec.lazyInstance.value
    }
}

export class Operation_ActivityJobs implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#ActivityJobs' as const;
    private readonly _query: ActivityJobsQuery;

    constructor(query: ActivityJobsQuery) {
        this._query = query
    }

    public get query(): ActivityJobsQuery {
        return this._query;
    }

    public toJSON(): Record<string, unknown> {
        return {
            query: this._query
        };
    }

    public with(overrides: {query?: ActivityJobsQuery}): Operation_ActivityJobs {
        return new Operation_ActivityJobs(
            'query' in overrides ? overrides.query! : this._query
        );
    }

    public static fromPlain(obj: {query: ActivityJobsQuery}): Operation_ActivityJobs {
        return new Operation_ActivityJobs(
            obj.query
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_ActivityJobs.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_ActivityJobs.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#ActivityJobs'
    public baboonTypeIdentifier() {
        return Operation_ActivityJobs.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0"]
    public baboonSameInVersions() {
        return Operation_ActivityJobs.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_ActivityJobs.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return Operation_ActivityJobs.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_ActivityJobs.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_ActivityJobs_JsonCodec {
        return Operation_ActivityJobs_JsonCodec.instance
    }
}

export class Operation_ActivityJobs_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_ActivityJobs): unknown {
        if (this !== Operation_ActivityJobs_JsonCodec.lazyInstance.value) {
          return Operation_ActivityJobs_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "query": ActivityJobsQuery_JsonCodec.instance.encode(BaboonCodecContext.Default, value.query),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_ActivityJobs {
        if (this !== Operation_ActivityJobs_JsonCodec .lazyInstance.value) {
            return Operation_ActivityJobs_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_ActivityJobs (
            ActivityJobsQuery_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["query"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_ActivityJobs_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_ActivityJobs_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#ActivityJobs'
    public baboonTypeIdentifier() {
        return Operation_ActivityJobs_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_ActivityJobs_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_ActivityJobs_JsonCodec())
    public static get instance(): Operation_ActivityJobs_JsonCodec {
        return Operation_ActivityJobs_JsonCodec.lazyInstance.value
    }
}

export class Operation_LocateMessage implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#LocateMessage' as const;
    private readonly _sessionId: string;
    private readonly _view: ContentView;
    private readonly _messageId: string;

    constructor(sessionId: string, view: ContentView, messageId: string) {
        this._sessionId = sessionId
        this._view = view
        this._messageId = messageId
    }

    public get sessionId(): string {
        return this._sessionId;
    }
    public get view(): ContentView {
        return this._view;
    }
    public get messageId(): string {
        return this._messageId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sessionId: this._sessionId,
            view: this._view,
            messageId: this._messageId
        };
    }

    public with(overrides: {sessionId?: string; view?: ContentView; messageId?: string}): Operation_LocateMessage {
        return new Operation_LocateMessage(
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId,
            'view' in overrides ? overrides.view! : this._view,
            'messageId' in overrides ? overrides.messageId! : this._messageId
        );
    }

    public static fromPlain(obj: {sessionId: string; view: ContentView; messageId: string}): Operation_LocateMessage {
        return new Operation_LocateMessage(
            obj.sessionId,
            obj.view,
            obj.messageId
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_LocateMessage.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_LocateMessage.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#LocateMessage'
    public baboonTypeIdentifier() {
        return Operation_LocateMessage.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0"]
    public baboonSameInVersions() {
        return Operation_LocateMessage.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_LocateMessage.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return Operation_LocateMessage.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_LocateMessage.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_LocateMessage_JsonCodec {
        return Operation_LocateMessage_JsonCodec.instance
    }
}

export class Operation_LocateMessage_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_LocateMessage): unknown {
        if (this !== Operation_LocateMessage_JsonCodec.lazyInstance.value) {
          return Operation_LocateMessage_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sessionId": value.sessionId,
            "view": ContentView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.view),
            "messageId": value.messageId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_LocateMessage {
        if (this !== Operation_LocateMessage_JsonCodec .lazyInstance.value) {
            return Operation_LocateMessage_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_LocateMessage (
            obj["sessionId"] as string,
            ContentView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["view"]),
            obj["messageId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_LocateMessage_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_LocateMessage_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#LocateMessage'
    public baboonTypeIdentifier() {
        return Operation_LocateMessage_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_LocateMessage_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_LocateMessage_JsonCodec())
    public static get instance(): Operation_LocateMessage_JsonCodec {
        return Operation_LocateMessage_JsonCodec.lazyInstance.value
    }
}

export class Operation_PreviewRetryFailed implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#PreviewRetryFailed' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): Operation_PreviewRetryFailed {
        return new Operation_PreviewRetryFailed(
            
        );
    }

    public static fromPlain(obj: {}): Operation_PreviewRetryFailed {
        return new Operation_PreviewRetryFailed(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_PreviewRetryFailed.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_PreviewRetryFailed.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#PreviewRetryFailed'
    public baboonTypeIdentifier() {
        return Operation_PreviewRetryFailed.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0"]
    public baboonSameInVersions() {
        return Operation_PreviewRetryFailed.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_PreviewRetryFailed.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return Operation_PreviewRetryFailed.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_PreviewRetryFailed.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_PreviewRetryFailed_JsonCodec {
        return Operation_PreviewRetryFailed_JsonCodec.instance
    }
}

export class Operation_PreviewRetryFailed_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_PreviewRetryFailed): unknown {
        if (this !== Operation_PreviewRetryFailed_JsonCodec.lazyInstance.value) {
          return Operation_PreviewRetryFailed_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_PreviewRetryFailed {
        if (this !== Operation_PreviewRetryFailed_JsonCodec .lazyInstance.value) {
            return Operation_PreviewRetryFailed_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_PreviewRetryFailed (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_PreviewRetryFailed_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_PreviewRetryFailed_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#PreviewRetryFailed'
    public baboonTypeIdentifier() {
        return Operation_PreviewRetryFailed_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_PreviewRetryFailed_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_PreviewRetryFailed_JsonCodec())
    public static get instance(): Operation_PreviewRetryFailed_JsonCodec {
        return Operation_PreviewRetryFailed_JsonCodec.lazyInstance.value
    }
}

export class Operation_ApplyRetryFailed implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed' as const;
    private readonly _targetProfile: string;
    private readonly _selectionHash: string;
    private readonly _confirm: boolean;

    constructor(targetProfile: string, selectionHash: string, confirm: boolean) {
        this._targetProfile = targetProfile
        this._selectionHash = selectionHash
        this._confirm = confirm
    }

    public get targetProfile(): string {
        return this._targetProfile;
    }
    public get selectionHash(): string {
        return this._selectionHash;
    }
    public get confirm(): boolean {
        return this._confirm;
    }

    public toJSON(): Record<string, unknown> {
        return {
            targetProfile: this._targetProfile,
            selectionHash: this._selectionHash,
            confirm: this._confirm
        };
    }

    public with(overrides: {targetProfile?: string; selectionHash?: string; confirm?: boolean}): Operation_ApplyRetryFailed {
        return new Operation_ApplyRetryFailed(
            'targetProfile' in overrides ? overrides.targetProfile! : this._targetProfile,
            'selectionHash' in overrides ? overrides.selectionHash! : this._selectionHash,
            'confirm' in overrides ? overrides.confirm! : this._confirm
        );
    }

    public static fromPlain(obj: {targetProfile: string; selectionHash: string; confirm: boolean}): Operation_ApplyRetryFailed {
        return new Operation_ApplyRetryFailed(
            obj.targetProfile,
            obj.selectionHash,
            obj.confirm
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_ApplyRetryFailed.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_ApplyRetryFailed.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed'
    public baboonTypeIdentifier() {
        return Operation_ApplyRetryFailed.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0"]
    public baboonSameInVersions() {
        return Operation_ApplyRetryFailed.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return Operation_ApplyRetryFailed.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return Operation_ApplyRetryFailed.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_ApplyRetryFailed.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_ApplyRetryFailed_JsonCodec {
        return Operation_ApplyRetryFailed_JsonCodec.instance
    }
}

export class Operation_ApplyRetryFailed_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_ApplyRetryFailed): unknown {
        if (this !== Operation_ApplyRetryFailed_JsonCodec.lazyInstance.value) {
          return Operation_ApplyRetryFailed_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "targetProfile": value.targetProfile,
            "selectionHash": value.selectionHash,
            "confirm": value.confirm,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_ApplyRetryFailed {
        if (this !== Operation_ApplyRetryFailed_JsonCodec .lazyInstance.value) {
            return Operation_ApplyRetryFailed_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_ApplyRetryFailed (
            obj["targetProfile"] as string,
            obj["selectionHash"] as string,
            obj["confirm"] as boolean,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_ApplyRetryFailed_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_ApplyRetryFailed_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed'
    public baboonTypeIdentifier() {
        return Operation_ApplyRetryFailed_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_ApplyRetryFailed_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_ApplyRetryFailed_JsonCodec())
    public static get instance(): Operation_ApplyRetryFailed_JsonCodec {
        return Operation_ApplyRetryFailed_JsonCodec.lazyInstance.value
    }
}


export class Operation_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation): unknown {
        if (this !== Operation_JsonCodec.lazyInstance.value) {
          return Operation_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof Operation_Hello) {
                return { "Hello": Operation_Hello_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_Ping) {
                return { "Ping": Operation_Ping_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_Pong) {
                return { "Pong": Operation_Pong_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_Whoami) {
                return { "Whoami": Operation_Whoami_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_Search) {
                return { "Search": Operation_Search_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_GetSession) {
                return { "GetSession": Operation_GetSession_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_GetChunks) {
                return { "GetChunks": Operation_GetChunks_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_GetMessages) {
                return { "GetMessages": Operation_GetMessages_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_GetRaw) {
                return { "GetRaw": Operation_GetRaw_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_Related) {
                return { "Related": Operation_Related_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_Facets) {
                return { "Facets": Operation_Facets_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_CollectionStatus) {
                return { "CollectionStatus": Operation_CollectionStatus_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_IngestStatus) {
                return { "IngestStatus": Operation_IngestStatus_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_RetryJob) {
                return { "RetryJob": Operation_RetryJob_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_ListTokens) {
                return { "ListTokens": Operation_ListTokens_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_MintToken) {
                return { "MintToken": Operation_MintToken_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_RevokeToken) {
                return { "RevokeToken": Operation_RevokeToken_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_ListGroups) {
                return { "ListGroups": Operation_ListGroups_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_CreateGroup) {
                return { "CreateGroup": Operation_CreateGroup_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_Invite) {
                return { "Invite": Operation_Invite_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_AcceptInvite) {
                return { "AcceptInvite": Operation_AcceptInvite_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_RemoveMember) {
                return { "RemoveMember": Operation_RemoveMember_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_LeaveGroup) {
                return { "LeaveGroup": Operation_LeaveGroup_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_DeleteGroup) {
                return { "DeleteGroup": Operation_DeleteGroup_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_Receipt) {
                return { "Receipt": Operation_Receipt_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_Purge) {
                return { "Purge": Operation_Purge_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_Logout) {
                return { "Logout": Operation_Logout_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_Archive) {
                return { "Archive": Operation_Archive_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_Activity) {
                return { "Activity": Operation_Activity_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_ActivityJobs) {
                return { "ActivityJobs": Operation_ActivityJobs_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_LocateMessage) {
                return { "LocateMessage": Operation_LocateMessage_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_PreviewRetryFailed) {
                return { "PreviewRetryFailed": Operation_PreviewRetryFailed_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_ApplyRetryFailed) {
                return { "ApplyRetryFailed": Operation_ApplyRetryFailed_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation {
        if (this !== Operation_JsonCodec .lazyInstance.value) {
            return Operation_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Hello": return Operation_Hello_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Ping": return Operation_Ping_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Pong": return Operation_Pong_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Whoami": return Operation_Whoami_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Search": return Operation_Search_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "GetSession": return Operation_GetSession_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "GetChunks": return Operation_GetChunks_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "GetMessages": return Operation_GetMessages_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "GetRaw": return Operation_GetRaw_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Related": return Operation_Related_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Facets": return Operation_Facets_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "CollectionStatus": return Operation_CollectionStatus_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "IngestStatus": return Operation_IngestStatus_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "RetryJob": return Operation_RetryJob_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ListTokens": return Operation_ListTokens_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "MintToken": return Operation_MintToken_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "RevokeToken": return Operation_RevokeToken_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ListGroups": return Operation_ListGroups_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "CreateGroup": return Operation_CreateGroup_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Invite": return Operation_Invite_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "AcceptInvite": return Operation_AcceptInvite_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "RemoveMember": return Operation_RemoveMember_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "LeaveGroup": return Operation_LeaveGroup_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "DeleteGroup": return Operation_DeleteGroup_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Receipt": return Operation_Receipt_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Purge": return Operation_Purge_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Logout": return Operation_Logout_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Archive": return Operation_Archive_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Activity": return Operation_Activity_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ActivityJobs": return Operation_ActivityJobs_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "LocateMessage": return Operation_LocateMessage_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "PreviewRetryFailed": return Operation_PreviewRetryFailed_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ApplyRetryFailed": return Operation_ApplyRetryFailed_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return Operation_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Operation_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonTypeIdentifier() {
        return Operation_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_JsonCodec())
    public static get instance(): Operation_JsonCodec {
        return Operation_JsonCodec.lazyInstance.value
    }
}