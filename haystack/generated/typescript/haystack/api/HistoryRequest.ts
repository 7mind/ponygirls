import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class HistoryRequest implements BaboonGeneratedLatest {
    private readonly _key: string;

    constructor(key: string) {
        this._key = key
    }

    public get key(): string {
        return this._key;
    }

    public toJSON(): Record<string, unknown> {
        return {
            key: this._key
        };
    }

    public with(overrides: {key?: string}): HistoryRequest {
        return new HistoryRequest(
            'key' in overrides ? overrides.key! : this._key
        );
    }

    public static fromPlain(obj: {key: string}): HistoryRequest {
        return new HistoryRequest(
            obj.key
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return HistoryRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return HistoryRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#HistoryRequest'
    public baboonTypeIdentifier() {
        return HistoryRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return HistoryRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return HistoryRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return HistoryRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): HistoryRequest_JsonCodec {
        return HistoryRequest_JsonCodec.instance
    }
}

export class HistoryRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: HistoryRequest): unknown {
        if (this !== HistoryRequest_JsonCodec.lazyInstance.value) {
          return HistoryRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "key": value.key,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): HistoryRequest {
        if (this !== HistoryRequest_JsonCodec .lazyInstance.value) {
            return HistoryRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new HistoryRequest (
            obj["key"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return HistoryRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return HistoryRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#HistoryRequest'
    public baboonTypeIdentifier() {
        return HistoryRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new HistoryRequest_JsonCodec())
    public static get instance(): HistoryRequest_JsonCodec {
        return HistoryRequest_JsonCodec.lazyInstance.value
    }
}