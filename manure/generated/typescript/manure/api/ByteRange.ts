import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'

export class ByteRange implements BaboonGeneratedLatest {
    private readonly _start: bigint;
    private readonly _endExclusive: bigint;

    constructor(start: bigint, endExclusive: bigint) {
        this._start = start
        this._endExclusive = endExclusive
    }

    public get start(): bigint {
        return this._start;
    }
    public get endExclusive(): bigint {
        return this._endExclusive;
    }

    public toJSON(): Record<string, unknown> {
        return {
            start: this._start,
            endExclusive: this._endExclusive
        };
    }

    public with(overrides: {start?: bigint; endExclusive?: bigint}): ByteRange {
        return new ByteRange(
            'start' in overrides ? overrides.start! : this._start,
            'endExclusive' in overrides ? overrides.endExclusive! : this._endExclusive
        );
    }

    public static fromPlain(obj: {start: bigint; endExclusive: bigint}): ByteRange {
        return new ByteRange(
            obj.start,
            obj.endExclusive
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ByteRange.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ByteRange.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ByteRange'
    public baboonTypeIdentifier() {
        return ByteRange.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ByteRange.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ByteRange.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ByteRange.BaboonMinReaderVersions
    }
    public static jsonCodec(): ByteRange_JsonCodec {
        return ByteRange_JsonCodec.instance
    }
}

export class ByteRange_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ByteRange): unknown {
        if (this !== ByteRange_JsonCodec.lazyInstance.value) {
          return ByteRange_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "start": value.start.toString(),
            "endExclusive": value.endExclusive.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ByteRange {
        if (this !== ByteRange_JsonCodec .lazyInstance.value) {
            return ByteRange_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ByteRange (
            BaboonInt64.read(obj["start"], "i64/u64"),
            BaboonInt64.read(obj["endExclusive"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ByteRange_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ByteRange_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ByteRange'
    public baboonTypeIdentifier() {
        return ByteRange_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ByteRange_JsonCodec())
    public static get instance(): ByteRange_JsonCodec {
        return ByteRange_JsonCodec.lazyInstance.value
    }
}