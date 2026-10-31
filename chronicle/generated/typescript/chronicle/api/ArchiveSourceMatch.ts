import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ArchiveMatchKind, ArchiveMatchKind_JsonCodec} from './ArchiveMatchKind.js'
import {ContentView, ContentView_JsonCodec} from './ContentView.js'
import {Span, Span_JsonCodec} from './Span.js'

export class ArchiveSourceMatch implements BaboonGeneratedLatest {
    private readonly _view: ContentView;
    private readonly _span: Span;
    private readonly _kind: ArchiveMatchKind;
    private readonly _operand: string;
    private readonly _summary: string | undefined;

    constructor(view: ContentView, span: Span, kind: ArchiveMatchKind, operand: string, summary: string | undefined) {
        this._view = view
        this._span = span
        this._kind = kind
        this._operand = operand
        this._summary = summary
    }

    public get view(): ContentView {
        return this._view;
    }
    public get span(): Span {
        return this._span;
    }
    public get kind(): ArchiveMatchKind {
        return this._kind;
    }
    public get operand(): string {
        return this._operand;
    }
    public get summary(): string | undefined {
        return this._summary;
    }

    public toJSON(): Record<string, unknown> {
        return {
            view: this._view,
            span: this._span,
            kind: this._kind,
            operand: this._operand,
            summary: this._summary !== undefined ? this._summary : undefined
        };
    }

    public with(overrides: {view?: ContentView; span?: Span; kind?: ArchiveMatchKind; operand?: string; summary?: string | undefined}): ArchiveSourceMatch {
        return new ArchiveSourceMatch(
            'view' in overrides ? overrides.view! : this._view,
            'span' in overrides ? overrides.span! : this._span,
            'kind' in overrides ? overrides.kind! : this._kind,
            'operand' in overrides ? overrides.operand! : this._operand,
            'summary' in overrides ? overrides.summary! : this._summary
        );
    }

    public static fromPlain(obj: {view: ContentView; span: Span; kind: ArchiveMatchKind; operand: string; summary: string | undefined}): ArchiveSourceMatch {
        return new ArchiveSourceMatch(
            obj.view,
            obj.span,
            obj.kind,
            obj.operand,
            obj.summary
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ArchiveSourceMatch.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ArchiveSourceMatch.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ArchiveSourceMatch'
    public baboonTypeIdentifier() {
        return ArchiveSourceMatch.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ArchiveSourceMatch.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ArchiveSourceMatch.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ArchiveSourceMatch.BaboonMinReaderVersions
    }
    public static jsonCodec(): ArchiveSourceMatch_JsonCodec {
        return ArchiveSourceMatch_JsonCodec.instance
    }
}

export class ArchiveSourceMatch_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ArchiveSourceMatch): unknown {
        if (this !== ArchiveSourceMatch_JsonCodec.lazyInstance.value) {
          return ArchiveSourceMatch_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "view": ContentView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.view),
            "span": Span_JsonCodec.instance.encode(BaboonCodecContext.Default, value.span),
            "kind": ArchiveMatchKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
            "operand": value.operand,
            "summary": value.summary === undefined ? null : value.summary,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ArchiveSourceMatch {
        if (this !== ArchiveSourceMatch_JsonCodec .lazyInstance.value) {
            return ArchiveSourceMatch_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ArchiveSourceMatch (
            ContentView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["view"]),
            Span_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["span"]),
            ArchiveMatchKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]),
            obj["operand"] as string,
            obj["summary"] === undefined || obj["summary"] === null ? undefined : obj["summary"] === undefined || obj["summary"] === null ? undefined : obj["summary"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ArchiveSourceMatch_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ArchiveSourceMatch_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ArchiveSourceMatch'
    public baboonTypeIdentifier() {
        return ArchiveSourceMatch_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ArchiveSourceMatch_JsonCodec())
    public static get instance(): ArchiveSourceMatch_JsonCodec {
        return ArchiveSourceMatch_JsonCodec.lazyInstance.value
    }
}