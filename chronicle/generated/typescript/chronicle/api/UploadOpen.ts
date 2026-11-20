import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {Completion, Completion_JsonCodec} from './Completion.js'
import {Metadata, Metadata_JsonCodec} from './Metadata.js'
import {SourceIdentity, SourceIdentity_JsonCodec} from './SourceIdentity.js'
import {UploadBase, UploadBase_JsonCodec} from './UploadBase.js'

export class UploadOpen implements BaboonGeneratedLatest {
    private readonly _requestId: string;
    private readonly _source: SourceIdentity;
    private readonly _expectedRevision: number;
    private readonly _rawPath: string;
    private readonly _base: UploadBase | undefined;
    private readonly _digest: string;
    private readonly _rawBytes: bigint;
    private readonly _messageCount: number;
    private readonly _messageChain: string;
    private readonly _completion: Completion;
    private readonly _redacted: boolean;
    private readonly _metadata: Metadata;

    constructor(requestId: string, source: SourceIdentity, expectedRevision: number, rawPath: string, base: UploadBase | undefined, digest: string, rawBytes: bigint, messageCount: number, messageChain: string, completion: Completion, redacted: boolean, metadata: Metadata) {
        this._requestId = requestId
        this._source = source
        this._expectedRevision = expectedRevision
        this._rawPath = rawPath
        this._base = base
        this._digest = digest
        this._rawBytes = rawBytes
        this._messageCount = messageCount
        this._messageChain = messageChain
        this._completion = completion
        this._redacted = redacted
        this._metadata = metadata
    }

    public get requestId(): string {
        return this._requestId;
    }
    public get source(): SourceIdentity {
        return this._source;
    }
    public get expectedRevision(): number {
        return this._expectedRevision;
    }
    public get rawPath(): string {
        return this._rawPath;
    }
    public get base(): UploadBase | undefined {
        return this._base;
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
    public get completion(): Completion {
        return this._completion;
    }
    public get redacted(): boolean {
        return this._redacted;
    }
    public get metadata(): Metadata {
        return this._metadata;
    }

    public toJSON(): Record<string, unknown> {
        return {
            requestId: this._requestId,
            source: this._source,
            expectedRevision: this._expectedRevision,
            rawPath: this._rawPath,
            base: this._base !== undefined ? this._base : undefined,
            digest: this._digest,
            rawBytes: this._rawBytes,
            messageCount: this._messageCount,
            messageChain: this._messageChain,
            completion: this._completion,
            redacted: this._redacted,
            metadata: this._metadata
        };
    }

    public with(overrides: {requestId?: string; source?: SourceIdentity; expectedRevision?: number; rawPath?: string; base?: UploadBase | undefined; digest?: string; rawBytes?: bigint; messageCount?: number; messageChain?: string; completion?: Completion; redacted?: boolean; metadata?: Metadata}): UploadOpen {
        return new UploadOpen(
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'source' in overrides ? overrides.source! : this._source,
            'expectedRevision' in overrides ? overrides.expectedRevision! : this._expectedRevision,
            'rawPath' in overrides ? overrides.rawPath! : this._rawPath,
            'base' in overrides ? overrides.base! : this._base,
            'digest' in overrides ? overrides.digest! : this._digest,
            'rawBytes' in overrides ? overrides.rawBytes! : this._rawBytes,
            'messageCount' in overrides ? overrides.messageCount! : this._messageCount,
            'messageChain' in overrides ? overrides.messageChain! : this._messageChain,
            'completion' in overrides ? overrides.completion! : this._completion,
            'redacted' in overrides ? overrides.redacted! : this._redacted,
            'metadata' in overrides ? overrides.metadata! : this._metadata
        );
    }

    public static fromPlain(obj: {requestId: string; source: SourceIdentity; expectedRevision: number; rawPath: string; base: UploadBase | undefined; digest: string; rawBytes: bigint; messageCount: number; messageChain: string; completion: Completion; redacted: boolean; metadata: Metadata}): UploadOpen {
        return new UploadOpen(
            obj.requestId,
            obj.source,
            obj.expectedRevision,
            obj.rawPath,
            obj.base,
            obj.digest,
            obj.rawBytes,
            obj.messageCount,
            obj.messageChain,
            obj.completion,
            obj.redacted,
            obj.metadata
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return UploadOpen.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return UploadOpen.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#UploadOpen'
    public baboonTypeIdentifier() {
        return UploadOpen.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return UploadOpen.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return UploadOpen.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return UploadOpen.BaboonMinReaderVersions
    }
    public static jsonCodec(): UploadOpen_JsonCodec {
        return UploadOpen_JsonCodec.instance
    }
}

export class UploadOpen_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: UploadOpen): unknown {
        if (this !== UploadOpen_JsonCodec.lazyInstance.value) {
          return UploadOpen_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "requestId": value.requestId,
            "source": SourceIdentity_JsonCodec.instance.encode(BaboonCodecContext.Default, value.source),
            "expectedRevision": value.expectedRevision,
            "rawPath": value.rawPath,
            "base": value.base === undefined ? null : UploadBase_JsonCodec.instance.encode(BaboonCodecContext.Default, value.base),
            "digest": value.digest,
            "rawBytes": value.rawBytes.toString(),
            "messageCount": value.messageCount,
            "messageChain": value.messageChain,
            "completion": Completion_JsonCodec.instance.encode(BaboonCodecContext.Default, value.completion),
            "redacted": value.redacted,
            "metadata": Metadata_JsonCodec.instance.encode(BaboonCodecContext.Default, value.metadata),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): UploadOpen {
        if (this !== UploadOpen_JsonCodec .lazyInstance.value) {
            return UploadOpen_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new UploadOpen (
            obj["requestId"] as string,
            SourceIdentity_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["source"]),
            obj["expectedRevision"] as number,
            obj["rawPath"] as string,
            obj["base"] === undefined || obj["base"] === null ? undefined : obj["base"] === undefined || obj["base"] === null ? undefined : UploadBase_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["base"]),
            obj["digest"] as string,
            BaboonInt64.read(obj["rawBytes"], "i64/u64"),
            obj["messageCount"] as number,
            obj["messageChain"] as string,
            Completion_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["completion"]),
            obj["redacted"] as boolean,
            Metadata_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["metadata"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return UploadOpen_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return UploadOpen_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#UploadOpen'
    public baboonTypeIdentifier() {
        return UploadOpen_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new UploadOpen_JsonCodec())
    public static get instance(): UploadOpen_JsonCodec {
        return UploadOpen_JsonCodec.lazyInstance.value
    }
}