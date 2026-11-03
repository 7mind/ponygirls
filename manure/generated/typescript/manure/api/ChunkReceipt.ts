import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'

export class ChunkReceipt implements BaboonGeneratedLatest {
    private readonly _path: string;
    private readonly _offset: bigint;
    private readonly _length: number;
    private readonly _receivedBytes: bigint;

    constructor(path: string, offset: bigint, length: number, receivedBytes: bigint) {
        this._path = path
        this._offset = offset
        this._length = length
        this._receivedBytes = receivedBytes
    }

    public get path(): string {
        return this._path;
    }
    public get offset(): bigint {
        return this._offset;
    }
    public get length(): number {
        return this._length;
    }
    public get receivedBytes(): bigint {
        return this._receivedBytes;
    }

    public toJSON(): Record<string, unknown> {
        return {
            path: this._path,
            offset: this._offset,
            length: this._length,
            receivedBytes: this._receivedBytes
        };
    }

    public with(overrides: {path?: string; offset?: bigint; length?: number; receivedBytes?: bigint}): ChunkReceipt {
        return new ChunkReceipt(
            'path' in overrides ? overrides.path! : this._path,
            'offset' in overrides ? overrides.offset! : this._offset,
            'length' in overrides ? overrides.length! : this._length,
            'receivedBytes' in overrides ? overrides.receivedBytes! : this._receivedBytes
        );
    }

    public static fromPlain(obj: {path: string; offset: bigint; length: number; receivedBytes: bigint}): ChunkReceipt {
        return new ChunkReceipt(
            obj.path,
            obj.offset,
            obj.length,
            obj.receivedBytes
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ChunkReceipt.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ChunkReceipt.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ChunkReceipt'
    public baboonTypeIdentifier() {
        return ChunkReceipt.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ChunkReceipt.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ChunkReceipt.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ChunkReceipt.BaboonMinReaderVersions
    }
    public static jsonCodec(): ChunkReceipt_JsonCodec {
        return ChunkReceipt_JsonCodec.instance
    }
}

export class ChunkReceipt_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ChunkReceipt): unknown {
        if (this !== ChunkReceipt_JsonCodec.lazyInstance.value) {
          return ChunkReceipt_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "path": value.path,
            "offset": value.offset.toString(),
            "length": value.length,
            "receivedBytes": value.receivedBytes.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ChunkReceipt {
        if (this !== ChunkReceipt_JsonCodec .lazyInstance.value) {
            return ChunkReceipt_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ChunkReceipt (
            obj["path"] as string,
            BaboonInt64.read(obj["offset"], "i64/u64"),
            obj["length"] as number,
            BaboonInt64.read(obj["receivedBytes"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ChunkReceipt_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ChunkReceipt_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ChunkReceipt'
    public baboonTypeIdentifier() {
        return ChunkReceipt_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ChunkReceipt_JsonCodec())
    public static get instance(): ChunkReceipt_JsonCodec {
        return ChunkReceipt_JsonCodec.lazyInstance.value
    }
}