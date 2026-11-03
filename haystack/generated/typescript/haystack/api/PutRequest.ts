import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {DocumentPayload, DocumentPayload_JsonCodec} from './DocumentPayload.js'

export class PutRequest implements BaboonGeneratedLatest {
    private readonly _key: string;
    private readonly _document: DocumentPayload;
    private readonly _expectedRevision: number;
    private readonly _requestId: string;

    constructor(key: string, document: DocumentPayload, expectedRevision: number, requestId: string) {
        this._key = key
        this._document = document
        this._expectedRevision = expectedRevision
        this._requestId = requestId
    }

    public get key(): string {
        return this._key;
    }
    public get document(): DocumentPayload {
        return this._document;
    }
    public get expectedRevision(): number {
        return this._expectedRevision;
    }
    public get requestId(): string {
        return this._requestId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            key: this._key,
            document: this._document,
            expectedRevision: this._expectedRevision,
            requestId: this._requestId
        };
    }

    public with(overrides: {key?: string; document?: DocumentPayload; expectedRevision?: number; requestId?: string}): PutRequest {
        return new PutRequest(
            'key' in overrides ? overrides.key! : this._key,
            'document' in overrides ? overrides.document! : this._document,
            'expectedRevision' in overrides ? overrides.expectedRevision! : this._expectedRevision,
            'requestId' in overrides ? overrides.requestId! : this._requestId
        );
    }

    public static fromPlain(obj: {key: string; document: DocumentPayload; expectedRevision: number; requestId: string}): PutRequest {
        return new PutRequest(
            obj.key,
            obj.document,
            obj.expectedRevision,
            obj.requestId
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return PutRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return PutRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#PutRequest'
    public baboonTypeIdentifier() {
        return PutRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return PutRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return PutRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return PutRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): PutRequest_JsonCodec {
        return PutRequest_JsonCodec.instance
    }
}

export class PutRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PutRequest): unknown {
        if (this !== PutRequest_JsonCodec.lazyInstance.value) {
          return PutRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "key": value.key,
            "document": DocumentPayload_JsonCodec.instance.encode(BaboonCodecContext.Default, value.document),
            "expectedRevision": value.expectedRevision,
            "requestId": value.requestId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PutRequest {
        if (this !== PutRequest_JsonCodec .lazyInstance.value) {
            return PutRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new PutRequest (
            obj["key"] as string,
            DocumentPayload_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["document"]),
            obj["expectedRevision"] as number,
            obj["requestId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return PutRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return PutRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#PutRequest'
    public baboonTypeIdentifier() {
        return PutRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PutRequest_JsonCodec())
    public static get instance(): PutRequest_JsonCodec {
        return PutRequest_JsonCodec.lazyInstance.value
    }
}