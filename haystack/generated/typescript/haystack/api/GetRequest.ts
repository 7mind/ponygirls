import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class GetRequest implements BaboonGeneratedLatest {
    private readonly _key: string;
    private readonly _revision: number | undefined;

    constructor(key: string, revision: number | undefined) {
        this._key = key
        this._revision = revision
    }

    public get key(): string {
        return this._key;
    }
    public get revision(): number | undefined {
        return this._revision;
    }

    public toJSON(): Record<string, unknown> {
        return {
            key: this._key,
            revision: this._revision !== undefined ? this._revision : undefined
        };
    }

    public with(overrides: {key?: string; revision?: number | undefined}): GetRequest {
        return new GetRequest(
            'key' in overrides ? overrides.key! : this._key,
            'revision' in overrides ? overrides.revision! : this._revision
        );
    }

    public static fromPlain(obj: {key: string; revision: number | undefined}): GetRequest {
        return new GetRequest(
            obj.key,
            obj.revision
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return GetRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return GetRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#GetRequest'
    public baboonTypeIdentifier() {
        return GetRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return GetRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return GetRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return GetRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): GetRequest_JsonCodec {
        return GetRequest_JsonCodec.instance
    }
}

export class GetRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GetRequest): unknown {
        if (this !== GetRequest_JsonCodec.lazyInstance.value) {
          return GetRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "key": value.key,
            "revision": value.revision === undefined ? null : value.revision,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GetRequest {
        if (this !== GetRequest_JsonCodec .lazyInstance.value) {
            return GetRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new GetRequest (
            obj["key"] as string,
            obj["revision"] === undefined || obj["revision"] === null ? undefined : obj["revision"] === undefined || obj["revision"] === null ? undefined : obj["revision"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return GetRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return GetRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#GetRequest'
    public baboonTypeIdentifier() {
        return GetRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GetRequest_JsonCodec())
    public static get instance(): GetRequest_JsonCodec {
        return GetRequest_JsonCodec.lazyInstance.value
    }
}