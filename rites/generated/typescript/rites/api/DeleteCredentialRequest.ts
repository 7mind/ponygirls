import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class DeleteCredentialRequest implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _expectedRevision: number;

    constructor(id: string, expectedRevision: number) {
        this._id = id
        this._expectedRevision = expectedRevision
    }

    public get id(): string {
        return this._id;
    }
    public get expectedRevision(): number {
        return this._expectedRevision;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            expectedRevision: this._expectedRevision
        };
    }

    public with(overrides: {id?: string; expectedRevision?: number}): DeleteCredentialRequest {
        return new DeleteCredentialRequest(
            'id' in overrides ? overrides.id! : this._id,
            'expectedRevision' in overrides ? overrides.expectedRevision! : this._expectedRevision
        );
    }

    public static fromPlain(obj: {id: string; expectedRevision: number}): DeleteCredentialRequest {
        return new DeleteCredentialRequest(
            obj.id,
            obj.expectedRevision
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return DeleteCredentialRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return DeleteCredentialRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#DeleteCredentialRequest'
    public baboonTypeIdentifier() {
        return DeleteCredentialRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return DeleteCredentialRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return DeleteCredentialRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return DeleteCredentialRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): DeleteCredentialRequest_JsonCodec {
        return DeleteCredentialRequest_JsonCodec.instance
    }
}

export class DeleteCredentialRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: DeleteCredentialRequest): unknown {
        if (this !== DeleteCredentialRequest_JsonCodec.lazyInstance.value) {
          return DeleteCredentialRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "expectedRevision": value.expectedRevision,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): DeleteCredentialRequest {
        if (this !== DeleteCredentialRequest_JsonCodec .lazyInstance.value) {
            return DeleteCredentialRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new DeleteCredentialRequest (
            obj["id"] as string,
            obj["expectedRevision"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return DeleteCredentialRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return DeleteCredentialRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#DeleteCredentialRequest'
    public baboonTypeIdentifier() {
        return DeleteCredentialRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new DeleteCredentialRequest_JsonCodec())
    public static get instance(): DeleteCredentialRequest_JsonCodec {
        return DeleteCredentialRequest_JsonCodec.lazyInstance.value
    }
}