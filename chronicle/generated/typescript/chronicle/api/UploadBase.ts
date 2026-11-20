import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'

export class UploadBase implements BaboonGeneratedLatest {
    private readonly _digest: string;
    private readonly _rawBytes: bigint;
    private readonly _messageCount: number;
    private readonly _messageChain: string;

    constructor(digest: string, rawBytes: bigint, messageCount: number, messageChain: string) {
        this._digest = digest
        this._rawBytes = rawBytes
        this._messageCount = messageCount
        this._messageChain = messageChain
    }

    public get digest(): string {
        return this._digest;
    }
    public get rawBytes(): bigint {
        return this._rawBytes;
    }
    public get messageCount(): number {
        return this._messageCount;
    }
    public get messageChain(): string {
        return this._messageChain;
    }

    public toJSON(): Record<string, unknown> {
        return {
            digest: this._digest,
            rawBytes: this._rawBytes,
            messageCount: this._messageCount,
            messageChain: this._messageChain
        };
    }

    public with(overrides: {digest?: string; rawBytes?: bigint; messageCount?: number; messageChain?: string}): UploadBase {
        return new UploadBase(
            'digest' in overrides ? overrides.digest! : this._digest,
            'rawBytes' in overrides ? overrides.rawBytes! : this._rawBytes,
            'messageCount' in overrides ? overrides.messageCount! : this._messageCount,
            'messageChain' in overrides ? overrides.messageChain! : this._messageChain
        );
    }

    public static fromPlain(obj: {digest: string; rawBytes: bigint; messageCount: number; messageChain: string}): UploadBase {
        return new UploadBase(
            obj.digest,
            obj.rawBytes,
            obj.messageCount,
            obj.messageChain
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return UploadBase.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return UploadBase.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#UploadBase'
    public baboonTypeIdentifier() {
        return UploadBase.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return UploadBase.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return UploadBase.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return UploadBase.BaboonMinReaderVersions
    }
    public static jsonCodec(): UploadBase_JsonCodec {
        return UploadBase_JsonCodec.instance
    }
}

export class UploadBase_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: UploadBase): unknown {
        if (this !== UploadBase_JsonCodec.lazyInstance.value) {
          return UploadBase_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "digest": value.digest,
            "rawBytes": value.rawBytes.toString(),
            "messageCount": value.messageCount,
            "messageChain": value.messageChain,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): UploadBase {
        if (this !== UploadBase_JsonCodec .lazyInstance.value) {
            return UploadBase_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new UploadBase (
            obj["digest"] as string,
            BaboonInt64.read(obj["rawBytes"], "i64/u64"),
            obj["messageCount"] as number,
            obj["messageChain"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return UploadBase_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return UploadBase_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#UploadBase'
    public baboonTypeIdentifier() {
        return UploadBase_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new UploadBase_JsonCodec())
    public static get instance(): UploadBase_JsonCodec {
        return UploadBase_JsonCodec.lazyInstance.value
    }
}