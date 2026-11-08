import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class ManualRunRequest implements BaboonGeneratedLatest {
    private readonly _repositoryId: string;
    private readonly _riteId: string;
    private readonly _requestId: string;

    constructor(repositoryId: string, riteId: string, requestId: string) {
        this._repositoryId = repositoryId
        this._riteId = riteId
        this._requestId = requestId
    }

    public get repositoryId(): string {
        return this._repositoryId;
    }
    public get riteId(): string {
        return this._riteId;
    }
    public get requestId(): string {
        return this._requestId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            repositoryId: this._repositoryId,
            riteId: this._riteId,
            requestId: this._requestId
        };
    }

    public with(overrides: {repositoryId?: string; riteId?: string; requestId?: string}): ManualRunRequest {
        return new ManualRunRequest(
            'repositoryId' in overrides ? overrides.repositoryId! : this._repositoryId,
            'riteId' in overrides ? overrides.riteId! : this._riteId,
            'requestId' in overrides ? overrides.requestId! : this._requestId
        );
    }

    public static fromPlain(obj: {repositoryId: string; riteId: string; requestId: string}): ManualRunRequest {
        return new ManualRunRequest(
            obj.repositoryId,
            obj.riteId,
            obj.requestId
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ManualRunRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return ManualRunRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#ManualRunRequest'
    public baboonTypeIdentifier() {
        return ManualRunRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ManualRunRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ManualRunRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ManualRunRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): ManualRunRequest_JsonCodec {
        return ManualRunRequest_JsonCodec.instance
    }
}

export class ManualRunRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ManualRunRequest): unknown {
        if (this !== ManualRunRequest_JsonCodec.lazyInstance.value) {
          return ManualRunRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "repositoryId": value.repositoryId,
            "riteId": value.riteId,
            "requestId": value.requestId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ManualRunRequest {
        if (this !== ManualRunRequest_JsonCodec .lazyInstance.value) {
            return ManualRunRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ManualRunRequest (
            obj["repositoryId"] as string,
            obj["riteId"] as string,
            obj["requestId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ManualRunRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return ManualRunRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#ManualRunRequest'
    public baboonTypeIdentifier() {
        return ManualRunRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ManualRunRequest_JsonCodec())
    public static get instance(): ManualRunRequest_JsonCodec {
        return ManualRunRequest_JsonCodec.lazyInstance.value
    }
}