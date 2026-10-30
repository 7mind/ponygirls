import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {ContentView, ContentView_JsonCodec} from './ContentView.js'
import {PassageFormat, PassageFormat_JsonCodec} from './PassageFormat.js'
import {PassageInfo, PassageInfo_JsonCodec} from './PassageInfo.js'

export class PassagesResult implements BaboonGeneratedLatest {
    private readonly _view: ContentView;
    private readonly _format: PassageFormat;
    private readonly _passages: Array<PassageInfo>;
    private readonly _total: bigint;
    private readonly _offset: number;

    constructor(view: ContentView, format: PassageFormat, passages: Array<PassageInfo>, total: bigint, offset: number) {
        this._view = view
        this._format = format
        this._passages = passages
        this._total = total
        this._offset = offset
    }

    public get view(): ContentView {
        return this._view;
    }
    public get format(): PassageFormat {
        return this._format;
    }
    public get passages(): Array<PassageInfo> {
        return this._passages;
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
            format: this._format,
            passages: this._passages,
            total: this._total,
            offset: this._offset
        };
    }

    public with(overrides: {view?: ContentView; format?: PassageFormat; passages?: Array<PassageInfo>; total?: bigint; offset?: number}): PassagesResult {
        return new PassagesResult(
            'view' in overrides ? overrides.view! : this._view,
            'format' in overrides ? overrides.format! : this._format,
            'passages' in overrides ? overrides.passages! : this._passages,
            'total' in overrides ? overrides.total! : this._total,
            'offset' in overrides ? overrides.offset! : this._offset
        );
    }

    public static fromPlain(obj: {view: ContentView; format: PassageFormat; passages: Array<PassageInfo>; total: bigint; offset: number}): PassagesResult {
        return new PassagesResult(
            obj.view,
            obj.format,
            obj.passages,
            obj.total,
            obj.offset
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return PassagesResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return PassagesResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#PassagesResult'
    public baboonTypeIdentifier() {
        return PassagesResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return PassagesResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return PassagesResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return PassagesResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): PassagesResult_JsonCodec {
        return PassagesResult_JsonCodec.instance
    }
}

export class PassagesResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PassagesResult): unknown {
        if (this !== PassagesResult_JsonCodec.lazyInstance.value) {
          return PassagesResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "view": ContentView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.view),
            "format": PassageFormat_JsonCodec.instance.encode(BaboonCodecContext.Default, value.format),
            "passages": Array.from(value.passages).map(item => PassageInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "total": value.total.toString(),
            "offset": value.offset,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PassagesResult {
        if (this !== PassagesResult_JsonCodec .lazyInstance.value) {
            return PassagesResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new PassagesResult (
            ContentView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["view"]),
            PassageFormat_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["format"]),
            (obj["passages"] as unknown[]).map(item => PassageInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            BaboonInt64.read(obj["total"], "i64/u64"),
            obj["offset"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return PassagesResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return PassagesResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#PassagesResult'
    public baboonTypeIdentifier() {
        return PassagesResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PassagesResult_JsonCodec())
    public static get instance(): PassagesResult_JsonCodec {
        return PassagesResult_JsonCodec.lazyInstance.value
    }
}