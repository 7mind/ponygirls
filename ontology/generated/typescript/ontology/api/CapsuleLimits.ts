import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class CapsuleLimits implements BaboonGeneratedLatest {
    private readonly _maxRecords: number;
    private readonly _maxPayloadBytes: number;

    constructor(maxRecords: number, maxPayloadBytes: number) {
        this._maxRecords = maxRecords
        this._maxPayloadBytes = maxPayloadBytes
    }

    public get maxRecords(): number {
        return this._maxRecords;
    }
    public get maxPayloadBytes(): number {
        return this._maxPayloadBytes;
    }

    public toJSON(): Record<string, unknown> {
        return {
            maxRecords: this._maxRecords,
            maxPayloadBytes: this._maxPayloadBytes
        };
    }

    public with(overrides: {maxRecords?: number; maxPayloadBytes?: number}): CapsuleLimits {
        return new CapsuleLimits(
            'maxRecords' in overrides ? overrides.maxRecords! : this._maxRecords,
            'maxPayloadBytes' in overrides ? overrides.maxPayloadBytes! : this._maxPayloadBytes
        );
    }

    public static fromPlain(obj: {maxRecords: number; maxPayloadBytes: number}): CapsuleLimits {
        return new CapsuleLimits(
            obj.maxRecords,
            obj.maxPayloadBytes
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleLimits.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleLimits.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleLimits'
    public baboonTypeIdentifier() {
        return CapsuleLimits.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CapsuleLimits.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CapsuleLimits.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CapsuleLimits.BaboonMinReaderVersions
    }
    public static jsonCodec(): CapsuleLimits_JsonCodec {
        return CapsuleLimits_JsonCodec.instance
    }
}

export class CapsuleLimits_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CapsuleLimits): unknown {
        if (this !== CapsuleLimits_JsonCodec.lazyInstance.value) {
          return CapsuleLimits_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "maxRecords": value.maxRecords,
            "maxPayloadBytes": value.maxPayloadBytes,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CapsuleLimits {
        if (this !== CapsuleLimits_JsonCodec .lazyInstance.value) {
            return CapsuleLimits_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CapsuleLimits (
            obj["maxRecords"] as number,
            obj["maxPayloadBytes"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleLimits_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleLimits_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleLimits'
    public baboonTypeIdentifier() {
        return CapsuleLimits_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CapsuleLimits_JsonCodec())
    public static get instance(): CapsuleLimits_JsonCodec {
        return CapsuleLimits_JsonCodec.lazyInstance.value
    }
}