import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ContentView, ContentView_JsonCodec} from './ContentView.js'
import {MessageSearchHit, MessageSearchHit_JsonCodec} from './MessageSearchHit.js'

export class SessionMessageSearchResult implements BaboonGeneratedLatest {
    private readonly _view: ContentView;
    private readonly _hits: Array<MessageSearchHit>;
    private readonly _nextCursor: string | undefined;

    constructor(view: ContentView, hits: Array<MessageSearchHit>, nextCursor: string | undefined) {
        this._view = view
        this._hits = hits
        this._nextCursor = nextCursor
    }

    public get view(): ContentView {
        return this._view;
    }
    public get hits(): Array<MessageSearchHit> {
        return this._hits;
    }
    public get nextCursor(): string | undefined {
        return this._nextCursor;
    }

    public toJSON(): Record<string, unknown> {
        return {
            view: this._view,
            hits: this._hits,
            nextCursor: this._nextCursor !== undefined ? this._nextCursor : undefined
        };
    }

    public with(overrides: {view?: ContentView; hits?: Array<MessageSearchHit>; nextCursor?: string | undefined}): SessionMessageSearchResult {
        return new SessionMessageSearchResult(
            'view' in overrides ? overrides.view! : this._view,
            'hits' in overrides ? overrides.hits! : this._hits,
            'nextCursor' in overrides ? overrides.nextCursor! : this._nextCursor
        );
    }

    public static fromPlain(obj: {view: ContentView; hits: Array<MessageSearchHit>; nextCursor: string | undefined}): SessionMessageSearchResult {
        return new SessionMessageSearchResult(
            obj.view,
            obj.hits,
            obj.nextCursor
        );
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return SessionMessageSearchResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SessionMessageSearchResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SessionMessageSearchResult'
    public baboonTypeIdentifier() {
        return SessionMessageSearchResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return SessionMessageSearchResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.7.0": "identical" }
    public baboonForwardReadable() {
        return SessionMessageSearchResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.6.0", "prefix-compact": "1.6.0", "prefix-any-mode": "1.6.0", "identical": "1.6.0" }
    public baboonMinReaderVersions() {
        return SessionMessageSearchResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): SessionMessageSearchResult_JsonCodec {
        return SessionMessageSearchResult_JsonCodec.instance
    }
}

export class SessionMessageSearchResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SessionMessageSearchResult): unknown {
        if (this !== SessionMessageSearchResult_JsonCodec.lazyInstance.value) {
          return SessionMessageSearchResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "view": ContentView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.view),
            "hits": Array.from(value.hits).map(item => MessageSearchHit_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "nextCursor": value.nextCursor === undefined ? null : value.nextCursor,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SessionMessageSearchResult {
        if (this !== SessionMessageSearchResult_JsonCodec .lazyInstance.value) {
            return SessionMessageSearchResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SessionMessageSearchResult (
            ContentView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["view"]),
            (obj["hits"] as unknown[]).map(item => MessageSearchHit_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return SessionMessageSearchResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SessionMessageSearchResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SessionMessageSearchResult'
    public baboonTypeIdentifier() {
        return SessionMessageSearchResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SessionMessageSearchResult_JsonCodec())
    public static get instance(): SessionMessageSearchResult_JsonCodec {
        return SessionMessageSearchResult_JsonCodec.lazyInstance.value
    }
}