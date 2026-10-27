import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {PassagePoint, PassagePoint_JsonCodec} from './PassagePoint.js'

export class PassageInfo implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _ordinal: number;
    private readonly _summary: string;
    private readonly _tags: Array<string>;
    private readonly _start: PassagePoint;
    private readonly _end: PassagePoint;
    private readonly _sourceBytes: bigint;
    private readonly _spanCount: bigint;
    private readonly _pieceCount: bigint;

    constructor(id: string, ordinal: number, summary: string, tags: Array<string>, start: PassagePoint, end: PassagePoint, sourceBytes: bigint, spanCount: bigint, pieceCount: bigint) {
        this._id = id
        this._ordinal = ordinal
        this._summary = summary
        this._tags = tags
        this._start = start
        this._end = end
        this._sourceBytes = sourceBytes
        this._spanCount = spanCount
        this._pieceCount = pieceCount
    }

    public get id(): string {
        return this._id;
    }
    public get ordinal(): number {
        return this._ordinal;
    }
    public get summary(): string {
        return this._summary;
    }
    public get tags(): Array<string> {
        return this._tags;
    }
    public get start(): PassagePoint {
        return this._start;
    }
    public get end(): PassagePoint {
        return this._end;
    }
    public get sourceBytes(): bigint {
        return this._sourceBytes;
    }
    public get spanCount(): bigint {
        return this._spanCount;
    }
    public get pieceCount(): bigint {
        return this._pieceCount;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            ordinal: this._ordinal,
            summary: this._summary,
            tags: this._tags,
            start: this._start,
            end: this._end,
            sourceBytes: this._sourceBytes,
            spanCount: this._spanCount,
            pieceCount: this._pieceCount
        };
    }

    public with(overrides: {id?: string; ordinal?: number; summary?: string; tags?: Array<string>; start?: PassagePoint; end?: PassagePoint; sourceBytes?: bigint; spanCount?: bigint; pieceCount?: bigint}): PassageInfo {
        return new PassageInfo(
            'id' in overrides ? overrides.id! : this._id,
            'ordinal' in overrides ? overrides.ordinal! : this._ordinal,
            'summary' in overrides ? overrides.summary! : this._summary,
            'tags' in overrides ? overrides.tags! : this._tags,
            'start' in overrides ? overrides.start! : this._start,
            'end' in overrides ? overrides.end! : this._end,
            'sourceBytes' in overrides ? overrides.sourceBytes! : this._sourceBytes,
            'spanCount' in overrides ? overrides.spanCount! : this._spanCount,
            'pieceCount' in overrides ? overrides.pieceCount! : this._pieceCount
        );
    }

    public static fromPlain(obj: {id: string; ordinal: number; summary: string; tags: Array<string>; start: PassagePoint; end: PassagePoint; sourceBytes: bigint; spanCount: bigint; pieceCount: bigint}): PassageInfo {
        return new PassageInfo(
            obj.id,
            obj.ordinal,
            obj.summary,
            obj.tags,
            obj.start,
            obj.end,
            obj.sourceBytes,
            obj.spanCount,
            obj.pieceCount
        );
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return PassageInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return PassageInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#PassageInfo'
    public baboonTypeIdentifier() {
        return PassageInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0"]
    public baboonSameInVersions() {
        return PassageInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.5.0": "identical" }
    public baboonForwardReadable() {
        return PassageInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return PassageInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): PassageInfo_JsonCodec {
        return PassageInfo_JsonCodec.instance
    }
}

export class PassageInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PassageInfo): unknown {
        if (this !== PassageInfo_JsonCodec.lazyInstance.value) {
          return PassageInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "ordinal": value.ordinal,
            "summary": value.summary,
            "tags": Array.from(value.tags),
            "start": PassagePoint_JsonCodec.instance.encode(BaboonCodecContext.Default, value.start),
            "end": PassagePoint_JsonCodec.instance.encode(BaboonCodecContext.Default, value.end),
            "sourceBytes": value.sourceBytes.toString(),
            "spanCount": value.spanCount.toString(),
            "pieceCount": value.pieceCount.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PassageInfo {
        if (this !== PassageInfo_JsonCodec .lazyInstance.value) {
            return PassageInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new PassageInfo (
            obj["id"] as string,
            obj["ordinal"] as number,
            obj["summary"] as string,
            (obj["tags"] as unknown[]).map(item => item as string),
            PassagePoint_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["start"]),
            PassagePoint_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["end"]),
            BaboonInt64.read(obj["sourceBytes"], "i64/u64"),
            BaboonInt64.read(obj["spanCount"], "i64/u64"),
            BaboonInt64.read(obj["pieceCount"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return PassageInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return PassageInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#PassageInfo'
    public baboonTypeIdentifier() {
        return PassageInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PassageInfo_JsonCodec())
    public static get instance(): PassageInfo_JsonCodec {
        return PassageInfo_JsonCodec.lazyInstance.value
    }
}