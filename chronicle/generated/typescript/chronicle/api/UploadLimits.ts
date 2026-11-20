import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'

export class UploadLimits implements BaboonGeneratedLatest {
    private readonly _maxPartBytes: bigint;
    private readonly _maxLargePartBytes: bigint;
    private readonly _maxRecordBytes: bigint;
    private readonly _maxRawBytes: bigint;
    private readonly _maxMessages: number;

    constructor(maxPartBytes: bigint, maxLargePartBytes: bigint, maxRecordBytes: bigint, maxRawBytes: bigint, maxMessages: number) {
        this._maxPartBytes = maxPartBytes
        this._maxLargePartBytes = maxLargePartBytes
        this._maxRecordBytes = maxRecordBytes
        this._maxRawBytes = maxRawBytes
        this._maxMessages = maxMessages
    }

    public get maxPartBytes(): bigint {
        return this._maxPartBytes;
    }
    public get maxLargePartBytes(): bigint {
        return this._maxLargePartBytes;
    }
    public get maxRecordBytes(): bigint {
        return this._maxRecordBytes;
    }
    public get maxRawBytes(): bigint {
        return this._maxRawBytes;
    }
    public get maxMessages(): number {
        return this._maxMessages;
    }

    public toJSON(): Record<string, unknown> {
        return {
            maxPartBytes: this._maxPartBytes,
            maxLargePartBytes: this._maxLargePartBytes,
            maxRecordBytes: this._maxRecordBytes,
            maxRawBytes: this._maxRawBytes,
            maxMessages: this._maxMessages
        };
    }

    public with(overrides: {maxPartBytes?: bigint; maxLargePartBytes?: bigint; maxRecordBytes?: bigint; maxRawBytes?: bigint; maxMessages?: number}): UploadLimits {
        return new UploadLimits(
            'maxPartBytes' in overrides ? overrides.maxPartBytes! : this._maxPartBytes,
            'maxLargePartBytes' in overrides ? overrides.maxLargePartBytes! : this._maxLargePartBytes,
            'maxRecordBytes' in overrides ? overrides.maxRecordBytes! : this._maxRecordBytes,
            'maxRawBytes' in overrides ? overrides.maxRawBytes! : this._maxRawBytes,
            'maxMessages' in overrides ? overrides.maxMessages! : this._maxMessages
        );
    }

    public static fromPlain(obj: {maxPartBytes: bigint; maxLargePartBytes: bigint; maxRecordBytes: bigint; maxRawBytes: bigint; maxMessages: number}): UploadLimits {
        return new UploadLimits(
            obj.maxPartBytes,
            obj.maxLargePartBytes,
            obj.maxRecordBytes,
            obj.maxRawBytes,
            obj.maxMessages
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return UploadLimits.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return UploadLimits.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#UploadLimits'
    public baboonTypeIdentifier() {
        return UploadLimits.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return UploadLimits.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return UploadLimits.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return UploadLimits.BaboonMinReaderVersions
    }
    public static jsonCodec(): UploadLimits_JsonCodec {
        return UploadLimits_JsonCodec.instance
    }
}

export class UploadLimits_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: UploadLimits): unknown {
        if (this !== UploadLimits_JsonCodec.lazyInstance.value) {
          return UploadLimits_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "maxPartBytes": value.maxPartBytes.toString(),
            "maxLargePartBytes": value.maxLargePartBytes.toString(),
            "maxRecordBytes": value.maxRecordBytes.toString(),
            "maxRawBytes": value.maxRawBytes.toString(),
            "maxMessages": value.maxMessages,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): UploadLimits {
        if (this !== UploadLimits_JsonCodec .lazyInstance.value) {
            return UploadLimits_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new UploadLimits (
            BaboonInt64.read(obj["maxPartBytes"], "i64/u64"),
            BaboonInt64.read(obj["maxLargePartBytes"], "i64/u64"),
            BaboonInt64.read(obj["maxRecordBytes"], "i64/u64"),
            BaboonInt64.read(obj["maxRawBytes"], "i64/u64"),
            obj["maxMessages"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return UploadLimits_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return UploadLimits_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#UploadLimits'
    public baboonTypeIdentifier() {
        return UploadLimits_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new UploadLimits_JsonCodec())
    public static get instance(): UploadLimits_JsonCodec {
        return UploadLimits_JsonCodec.lazyInstance.value
    }
}