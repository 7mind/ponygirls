import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {ByteRange, ByteRange_JsonCodec} from './ByteRange.js'

export class FileProgress implements BaboonGeneratedLatest {
    private readonly _path: string;
    private readonly _size: bigint;
    private readonly _receivedBytes: bigint;
    private readonly _receivedRanges: Array<ByteRange>;

    constructor(path: string, size: bigint, receivedBytes: bigint, receivedRanges: Array<ByteRange>) {
        this._path = path
        this._size = size
        this._receivedBytes = receivedBytes
        this._receivedRanges = receivedRanges
    }

    public get path(): string {
        return this._path;
    }
    public get size(): bigint {
        return this._size;
    }
    public get receivedBytes(): bigint {
        return this._receivedBytes;
    }
    public get receivedRanges(): Array<ByteRange> {
        return this._receivedRanges;
    }

    public toJSON(): Record<string, unknown> {
        return {
            path: this._path,
            size: this._size,
            receivedBytes: this._receivedBytes,
            receivedRanges: this._receivedRanges
        };
    }

    public with(overrides: {path?: string; size?: bigint; receivedBytes?: bigint; receivedRanges?: Array<ByteRange>}): FileProgress {
        return new FileProgress(
            'path' in overrides ? overrides.path! : this._path,
            'size' in overrides ? overrides.size! : this._size,
            'receivedBytes' in overrides ? overrides.receivedBytes! : this._receivedBytes,
            'receivedRanges' in overrides ? overrides.receivedRanges! : this._receivedRanges
        );
    }

    public static fromPlain(obj: {path: string; size: bigint; receivedBytes: bigint; receivedRanges: Array<ByteRange>}): FileProgress {
        return new FileProgress(
            obj.path,
            obj.size,
            obj.receivedBytes,
            obj.receivedRanges
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return FileProgress.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return FileProgress.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#FileProgress'
    public baboonTypeIdentifier() {
        return FileProgress.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return FileProgress.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return FileProgress.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return FileProgress.BaboonMinReaderVersions
    }
    public static jsonCodec(): FileProgress_JsonCodec {
        return FileProgress_JsonCodec.instance
    }
}

export class FileProgress_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: FileProgress): unknown {
        if (this !== FileProgress_JsonCodec.lazyInstance.value) {
          return FileProgress_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "path": value.path,
            "size": value.size.toString(),
            "receivedBytes": value.receivedBytes.toString(),
            "receivedRanges": Array.from(value.receivedRanges).map(item => ByteRange_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): FileProgress {
        if (this !== FileProgress_JsonCodec .lazyInstance.value) {
            return FileProgress_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new FileProgress (
            obj["path"] as string,
            BaboonInt64.read(obj["size"], "i64/u64"),
            BaboonInt64.read(obj["receivedBytes"], "i64/u64"),
            (obj["receivedRanges"] as unknown[]).map(item => ByteRange_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return FileProgress_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return FileProgress_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#FileProgress'
    public baboonTypeIdentifier() {
        return FileProgress_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new FileProgress_JsonCodec())
    public static get instance(): FileProgress_JsonCodec {
        return FileProgress_JsonCodec.lazyInstance.value
    }
}