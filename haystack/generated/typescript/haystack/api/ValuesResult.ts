import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class ValuesResult implements BaboonGeneratedLatest {
    private readonly _values: Array<string>;

    constructor(values: Array<string>) {
        this._values = values
    }

    public get values(): Array<string> {
        return this._values;
    }

    public toJSON(): Record<string, unknown> {
        return {
            values: this._values
        };
    }

    public with(overrides: {values?: Array<string>}): ValuesResult {
        return new ValuesResult(
            'values' in overrides ? overrides.values! : this._values
        );
    }

    public static fromPlain(obj: {values: Array<string>}): ValuesResult {
        return new ValuesResult(
            obj.values
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ValuesResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return ValuesResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#ValuesResult'
    public baboonTypeIdentifier() {
        return ValuesResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ValuesResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ValuesResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ValuesResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): ValuesResult_JsonCodec {
        return ValuesResult_JsonCodec.instance
    }
}

export class ValuesResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ValuesResult): unknown {
        if (this !== ValuesResult_JsonCodec.lazyInstance.value) {
          return ValuesResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "values": Array.from(value.values),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ValuesResult {
        if (this !== ValuesResult_JsonCodec .lazyInstance.value) {
            return ValuesResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ValuesResult (
            (obj["values"] as unknown[]).map(item => item as string),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ValuesResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return ValuesResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#ValuesResult'
    public baboonTypeIdentifier() {
        return ValuesResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ValuesResult_JsonCodec())
    public static get instance(): ValuesResult_JsonCodec {
        return ValuesResult_JsonCodec.lazyInstance.value
    }
}