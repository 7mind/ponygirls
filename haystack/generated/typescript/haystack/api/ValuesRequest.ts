import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class ValuesRequest implements BaboonGeneratedLatest {
    private readonly _field: string;

    constructor(field: string) {
        this._field = field
    }

    public get field(): string {
        return this._field;
    }

    public toJSON(): Record<string, unknown> {
        return {
            field: this._field
        };
    }

    public with(overrides: {field?: string}): ValuesRequest {
        return new ValuesRequest(
            'field' in overrides ? overrides.field! : this._field
        );
    }

    public static fromPlain(obj: {field: string}): ValuesRequest {
        return new ValuesRequest(
            obj.field
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ValuesRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return ValuesRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#ValuesRequest'
    public baboonTypeIdentifier() {
        return ValuesRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ValuesRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ValuesRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ValuesRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): ValuesRequest_JsonCodec {
        return ValuesRequest_JsonCodec.instance
    }
}

export class ValuesRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ValuesRequest): unknown {
        if (this !== ValuesRequest_JsonCodec.lazyInstance.value) {
          return ValuesRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "field": value.field,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ValuesRequest {
        if (this !== ValuesRequest_JsonCodec .lazyInstance.value) {
            return ValuesRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ValuesRequest (
            obj["field"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ValuesRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return ValuesRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#ValuesRequest'
    public baboonTypeIdentifier() {
        return ValuesRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ValuesRequest_JsonCodec())
    public static get instance(): ValuesRequest_JsonCodec {
        return ValuesRequest_JsonCodec.lazyInstance.value
    }
}