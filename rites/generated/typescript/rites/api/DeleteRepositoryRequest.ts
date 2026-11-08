import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class DeleteRepositoryRequest implements BaboonGeneratedLatest {
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

    public with(overrides: {id?: string; expectedRevision?: number}): DeleteRepositoryRequest {
        return new DeleteRepositoryRequest(
            'id' in overrides ? overrides.id! : this._id,
            'expectedRevision' in overrides ? overrides.expectedRevision! : this._expectedRevision
        );
    }

    public static fromPlain(obj: {id: string; expectedRevision: number}): DeleteRepositoryRequest {
        return new DeleteRepositoryRequest(
            obj.id,
            obj.expectedRevision
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return DeleteRepositoryRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return DeleteRepositoryRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#DeleteRepositoryRequest'
    public baboonTypeIdentifier() {
        return DeleteRepositoryRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return DeleteRepositoryRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return DeleteRepositoryRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return DeleteRepositoryRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): DeleteRepositoryRequest_JsonCodec {
        return DeleteRepositoryRequest_JsonCodec.instance
    }
}

export class DeleteRepositoryRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: DeleteRepositoryRequest): unknown {
        if (this !== DeleteRepositoryRequest_JsonCodec.lazyInstance.value) {
          return DeleteRepositoryRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "expectedRevision": value.expectedRevision,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): DeleteRepositoryRequest {
        if (this !== DeleteRepositoryRequest_JsonCodec .lazyInstance.value) {
            return DeleteRepositoryRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new DeleteRepositoryRequest (
            obj["id"] as string,
            obj["expectedRevision"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return DeleteRepositoryRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return DeleteRepositoryRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#DeleteRepositoryRequest'
    public baboonTypeIdentifier() {
        return DeleteRepositoryRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new DeleteRepositoryRequest_JsonCodec())
    public static get instance(): DeleteRepositoryRequest_JsonCodec {
        return DeleteRepositoryRequest_JsonCodec.lazyInstance.value
    }
}