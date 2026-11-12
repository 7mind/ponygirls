import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'

export class CurationAuditPayload implements BaboonGeneratedLatest {
    private readonly _encoding: string;
    private readonly _content: string;
    private readonly _digest: string;
    private readonly _bytes: bigint;

    constructor(encoding: string, content: string, digest: string, bytes: bigint) {
        this._encoding = encoding
        this._content = content
        this._digest = digest
        this._bytes = bytes
    }

    public get encoding(): string {
        return this._encoding;
    }
    public get content(): string {
        return this._content;
    }
    public get digest(): string {
        return this._digest;
    }
    public get bytes(): bigint {
        return this._bytes;
    }

    public toJSON(): Record<string, unknown> {
        return {
            encoding: this._encoding,
            content: this._content,
            digest: this._digest,
            bytes: this._bytes
        };
    }

    public with(overrides: {encoding?: string; content?: string; digest?: string; bytes?: bigint}): CurationAuditPayload {
        return new CurationAuditPayload(
            'encoding' in overrides ? overrides.encoding! : this._encoding,
            'content' in overrides ? overrides.content! : this._content,
            'digest' in overrides ? overrides.digest! : this._digest,
            'bytes' in overrides ? overrides.bytes! : this._bytes
        );
    }

    public static fromPlain(obj: {encoding: string; content: string; digest: string; bytes: bigint}): CurationAuditPayload {
        return new CurationAuditPayload(
            obj.encoding,
            obj.content,
            obj.digest,
            obj.bytes
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationAuditPayload.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationAuditPayload.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationAuditPayload'
    public baboonTypeIdentifier() {
        return CurationAuditPayload.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CurationAuditPayload.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CurationAuditPayload.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CurationAuditPayload.BaboonMinReaderVersions
    }
    public static jsonCodec(): CurationAuditPayload_JsonCodec {
        return CurationAuditPayload_JsonCodec.instance
    }
}

export class CurationAuditPayload_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationAuditPayload): unknown {
        if (this !== CurationAuditPayload_JsonCodec.lazyInstance.value) {
          return CurationAuditPayload_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "encoding": value.encoding,
            "content": value.content,
            "digest": value.digest,
            "bytes": value.bytes.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationAuditPayload {
        if (this !== CurationAuditPayload_JsonCodec .lazyInstance.value) {
            return CurationAuditPayload_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CurationAuditPayload (
            obj["encoding"] as string,
            obj["content"] as string,
            obj["digest"] as string,
            BaboonInt64.read(obj["bytes"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationAuditPayload_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationAuditPayload_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationAuditPayload'
    public baboonTypeIdentifier() {
        return CurationAuditPayload_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationAuditPayload_JsonCodec())
    public static get instance(): CurationAuditPayload_JsonCodec {
        return CurationAuditPayload_JsonCodec.lazyInstance.value
    }
}