import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'

export class RawFileInfo implements BaboonGeneratedLatest {
    private readonly _index: number;
    private readonly _path: string;
    private readonly _sha256: string;
    private readonly _bytes: bigint;

    constructor(index: number, path: string, sha256: string, bytes: bigint) {
        this._index = index
        this._path = path
        this._sha256 = sha256
        this._bytes = bytes
    }

    public get index(): number {
        return this._index;
    }
    public get path(): string {
        return this._path;
    }
    public get sha256(): string {
        return this._sha256;
    }
    public get bytes(): bigint {
        return this._bytes;
    }

    public toJSON(): Record<string, unknown> {
        return {
            index: this._index,
            path: this._path,
            sha256: this._sha256,
            bytes: this._bytes
        };
    }

    public with(overrides: {index?: number; path?: string; sha256?: string; bytes?: bigint}): RawFileInfo {
        return new RawFileInfo(
            'index' in overrides ? overrides.index! : this._index,
            'path' in overrides ? overrides.path! : this._path,
            'sha256' in overrides ? overrides.sha256! : this._sha256,
            'bytes' in overrides ? overrides.bytes! : this._bytes
        );
    }

    public static fromPlain(obj: {index: number; path: string; sha256: string; bytes: bigint}): RawFileInfo {
        return new RawFileInfo(
            obj.index,
            obj.path,
            obj.sha256,
            obj.bytes
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return RawFileInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RawFileInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RawFileInfo'
    public baboonTypeIdentifier() {
        return RawFileInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return RawFileInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return RawFileInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return RawFileInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): RawFileInfo_JsonCodec {
        return RawFileInfo_JsonCodec.instance
    }
}

export class RawFileInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RawFileInfo): unknown {
        if (this !== RawFileInfo_JsonCodec.lazyInstance.value) {
          return RawFileInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "index": value.index,
            "path": value.path,
            "sha256": value.sha256,
            "bytes": value.bytes.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RawFileInfo {
        if (this !== RawFileInfo_JsonCodec .lazyInstance.value) {
            return RawFileInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RawFileInfo (
            obj["index"] as number,
            obj["path"] as string,
            obj["sha256"] as string,
            BaboonInt64.read(obj["bytes"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return RawFileInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RawFileInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RawFileInfo'
    public baboonTypeIdentifier() {
        return RawFileInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RawFileInfo_JsonCodec())
    public static get instance(): RawFileInfo_JsonCodec {
        return RawFileInfo_JsonCodec.lazyInstance.value
    }
}