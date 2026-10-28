import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../../BaboonSharedRuntime.js'
import {ContentView, ContentView_JsonCodec} from './ContentView.js'
import {PassageSourceSpan, PassageSourceSpan_JsonCodec} from './PassageSourceSpan.js'

export class PassageSpansResult implements BaboonGenerated {
    private readonly _view: ContentView;
    private readonly _passageId: string;
    private readonly _spans: Array<PassageSourceSpan>;
    private readonly _total: bigint;
    private readonly _offset: number;

    constructor(view: ContentView, passageId: string, spans: Array<PassageSourceSpan>, total: bigint, offset: number) {
        this._view = view
        this._passageId = passageId
        this._spans = spans
        this._total = total
        this._offset = offset
    }

    public get view(): ContentView {
        return this._view;
    }
    public get passageId(): string {
        return this._passageId;
    }
    public get spans(): Array<PassageSourceSpan> {
        return this._spans;
    }
    public get total(): bigint {
        return this._total;
    }
    public get offset(): number {
        return this._offset;
    }

    public toJSON(): Record<string, unknown> {
        return {
            view: this._view,
            passageId: this._passageId,
            spans: this._spans,
            total: this._total,
            offset: this._offset
        };
    }

    public with(overrides: {view?: ContentView; passageId?: string; spans?: Array<PassageSourceSpan>; total?: bigint; offset?: number}): PassageSpansResult {
        return new PassageSpansResult(
            'view' in overrides ? overrides.view! : this._view,
            'passageId' in overrides ? overrides.passageId! : this._passageId,
            'spans' in overrides ? overrides.spans! : this._spans,
            'total' in overrides ? overrides.total! : this._total,
            'offset' in overrides ? overrides.offset! : this._offset
        );
    }

    public static fromPlain(obj: {view: ContentView; passageId: string; spans: Array<PassageSourceSpan>; total: bigint; offset: number}): PassageSpansResult {
        return new PassageSpansResult(
            obj.view,
            obj.passageId,
            obj.spans,
            obj.total,
            obj.offset
        );
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return PassageSpansResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return PassageSpansResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#PassageSpansResult'
    public baboonTypeIdentifier() {
        return PassageSpansResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return PassageSpansResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return PassageSpansResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return PassageSpansResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): PassageSpansResult_JsonCodec {
        return PassageSpansResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.7.0 */
export class PassageSpansResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PassageSpansResult): unknown {
        if (this !== PassageSpansResult_JsonCodec.lazyInstance.value) {
          return PassageSpansResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "view": ContentView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.view),
            "passageId": value.passageId,
            "spans": Array.from(value.spans).map(item => PassageSourceSpan_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "total": value.total.toString(),
            "offset": value.offset,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PassageSpansResult {
        if (this !== PassageSpansResult_JsonCodec .lazyInstance.value) {
            return PassageSpansResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new PassageSpansResult (
            ContentView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["view"]),
            obj["passageId"] as string,
            (obj["spans"] as unknown[]).map(item => PassageSourceSpan_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            BaboonInt64.read(obj["total"], "i64/u64"),
            obj["offset"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return PassageSpansResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return PassageSpansResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#PassageSpansResult'
    public baboonTypeIdentifier() {
        return PassageSpansResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PassageSpansResult_JsonCodec())
    public static get instance(): PassageSpansResult_JsonCodec {
        return PassageSpansResult_JsonCodec.lazyInstance.value
    }
}