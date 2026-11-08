import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class DeleteRiteRequest implements BaboonGeneratedLatest {
    private readonly _repositoryId: string;
    private readonly _id: string;
    private readonly _expectedRevision: number;

    constructor(repositoryId: string, id: string, expectedRevision: number) {
        this._repositoryId = repositoryId
        this._id = id
        this._expectedRevision = expectedRevision
    }

    public get repositoryId(): string {
        return this._repositoryId;
    }
    public get id(): string {
        return this._id;
    }
    public get expectedRevision(): number {
        return this._expectedRevision;
    }

    public toJSON(): Record<string, unknown> {
        return {
            repositoryId: this._repositoryId,
            id: this._id,
            expectedRevision: this._expectedRevision
        };
    }

    public with(overrides: {repositoryId?: string; id?: string; expectedRevision?: number}): DeleteRiteRequest {
        return new DeleteRiteRequest(
            'repositoryId' in overrides ? overrides.repositoryId! : this._repositoryId,
            'id' in overrides ? overrides.id! : this._id,
            'expectedRevision' in overrides ? overrides.expectedRevision! : this._expectedRevision
        );
    }

    public static fromPlain(obj: {repositoryId: string; id: string; expectedRevision: number}): DeleteRiteRequest {
        return new DeleteRiteRequest(
            obj.repositoryId,
            obj.id,
            obj.expectedRevision
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return DeleteRiteRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return DeleteRiteRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#DeleteRiteRequest'
    public baboonTypeIdentifier() {
        return DeleteRiteRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return DeleteRiteRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return DeleteRiteRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return DeleteRiteRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): DeleteRiteRequest_JsonCodec {
        return DeleteRiteRequest_JsonCodec.instance
    }
}

export class DeleteRiteRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: DeleteRiteRequest): unknown {
        if (this !== DeleteRiteRequest_JsonCodec.lazyInstance.value) {
          return DeleteRiteRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "repositoryId": value.repositoryId,
            "id": value.id,
            "expectedRevision": value.expectedRevision,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): DeleteRiteRequest {
        if (this !== DeleteRiteRequest_JsonCodec .lazyInstance.value) {
            return DeleteRiteRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new DeleteRiteRequest (
            obj["repositoryId"] as string,
            obj["id"] as string,
            obj["expectedRevision"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return DeleteRiteRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return DeleteRiteRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#DeleteRiteRequest'
    public baboonTypeIdentifier() {
        return DeleteRiteRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new DeleteRiteRequest_JsonCodec())
    public static get instance(): DeleteRiteRequest_JsonCodec {
        return DeleteRiteRequest_JsonCodec.lazyInstance.value
    }
}