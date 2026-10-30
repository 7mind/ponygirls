import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ContentView, ContentView_JsonCodec} from './ContentView.js'
import {ContextExcerpt, ContextExcerpt_JsonCodec} from './ContextExcerpt.js'
import {PassageSourceSpan, PassageSourceSpan_JsonCodec} from './PassageSourceSpan.js'
import {Span, Span_JsonCodec} from './Span.js'

export class MessageContextResult implements BaboonGeneratedLatest {
    private readonly _sessionId: string;
    private readonly _view: ContentView;
    private readonly _anchor: PassageSourceSpan;
    private readonly _excerpts: Array<ContextExcerpt>;
    private readonly _previous: Span | undefined;
    private readonly _next: Span | undefined;

    constructor(sessionId: string, view: ContentView, anchor: PassageSourceSpan, excerpts: Array<ContextExcerpt>, previous: Span | undefined, next: Span | undefined) {
        this._sessionId = sessionId
        this._view = view
        this._anchor = anchor
        this._excerpts = excerpts
        this._previous = previous
        this._next = next
    }

    public get sessionId(): string {
        return this._sessionId;
    }
    public get view(): ContentView {
        return this._view;
    }
    public get anchor(): PassageSourceSpan {
        return this._anchor;
    }
    public get excerpts(): Array<ContextExcerpt> {
        return this._excerpts;
    }
    public get previous(): Span | undefined {
        return this._previous;
    }
    public get next(): Span | undefined {
        return this._next;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sessionId: this._sessionId,
            view: this._view,
            anchor: this._anchor,
            excerpts: this._excerpts,
            previous: this._previous !== undefined ? this._previous : undefined,
            next: this._next !== undefined ? this._next : undefined
        };
    }

    public with(overrides: {sessionId?: string; view?: ContentView; anchor?: PassageSourceSpan; excerpts?: Array<ContextExcerpt>; previous?: Span | undefined; next?: Span | undefined}): MessageContextResult {
        return new MessageContextResult(
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId,
            'view' in overrides ? overrides.view! : this._view,
            'anchor' in overrides ? overrides.anchor! : this._anchor,
            'excerpts' in overrides ? overrides.excerpts! : this._excerpts,
            'previous' in overrides ? overrides.previous! : this._previous,
            'next' in overrides ? overrides.next! : this._next
        );
    }

    public static fromPlain(obj: {sessionId: string; view: ContentView; anchor: PassageSourceSpan; excerpts: Array<ContextExcerpt>; previous: Span | undefined; next: Span | undefined}): MessageContextResult {
        return new MessageContextResult(
            obj.sessionId,
            obj.view,
            obj.anchor,
            obj.excerpts,
            obj.previous,
            obj.next
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return MessageContextResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return MessageContextResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#MessageContextResult'
    public baboonTypeIdentifier() {
        return MessageContextResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return MessageContextResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return MessageContextResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return MessageContextResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): MessageContextResult_JsonCodec {
        return MessageContextResult_JsonCodec.instance
    }
}

export class MessageContextResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: MessageContextResult): unknown {
        if (this !== MessageContextResult_JsonCodec.lazyInstance.value) {
          return MessageContextResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sessionId": value.sessionId,
            "view": ContentView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.view),
            "anchor": PassageSourceSpan_JsonCodec.instance.encode(BaboonCodecContext.Default, value.anchor),
            "excerpts": Array.from(value.excerpts).map(item => ContextExcerpt_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "previous": value.previous === undefined ? null : Span_JsonCodec.instance.encode(BaboonCodecContext.Default, value.previous),
            "next": value.next === undefined ? null : Span_JsonCodec.instance.encode(BaboonCodecContext.Default, value.next),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): MessageContextResult {
        if (this !== MessageContextResult_JsonCodec .lazyInstance.value) {
            return MessageContextResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new MessageContextResult (
            obj["sessionId"] as string,
            ContentView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["view"]),
            PassageSourceSpan_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["anchor"]),
            (obj["excerpts"] as unknown[]).map(item => ContextExcerpt_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["previous"] === undefined || obj["previous"] === null ? undefined : obj["previous"] === undefined || obj["previous"] === null ? undefined : Span_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["previous"]),
            obj["next"] === undefined || obj["next"] === null ? undefined : obj["next"] === undefined || obj["next"] === null ? undefined : Span_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["next"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return MessageContextResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return MessageContextResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#MessageContextResult'
    public baboonTypeIdentifier() {
        return MessageContextResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new MessageContextResult_JsonCodec())
    public static get instance(): MessageContextResult_JsonCodec {
        return MessageContextResult_JsonCodec.lazyInstance.value
    }
}