import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'

export class CurationAdmissionLimits implements BaboonGeneratedLatest {
    private readonly _maxOrdinals: number;
    private readonly _maxAuditBytes: number;
    private readonly _maxInputBytes: bigint;
    private readonly _maxPins: number;
    private readonly _maxLabelChars: number;

    constructor(maxOrdinals: number, maxAuditBytes: number, maxInputBytes: bigint, maxPins: number, maxLabelChars: number) {
        this._maxOrdinals = maxOrdinals
        this._maxAuditBytes = maxAuditBytes
        this._maxInputBytes = maxInputBytes
        this._maxPins = maxPins
        this._maxLabelChars = maxLabelChars
    }

    public get maxOrdinals(): number {
        return this._maxOrdinals;
    }
    public get maxAuditBytes(): number {
        return this._maxAuditBytes;
    }
    public get maxInputBytes(): bigint {
        return this._maxInputBytes;
    }
    public get maxPins(): number {
        return this._maxPins;
    }
    public get maxLabelChars(): number {
        return this._maxLabelChars;
    }

    public toJSON(): Record<string, unknown> {
        return {
            maxOrdinals: this._maxOrdinals,
            maxAuditBytes: this._maxAuditBytes,
            maxInputBytes: this._maxInputBytes,
            maxPins: this._maxPins,
            maxLabelChars: this._maxLabelChars
        };
    }

    public with(overrides: {maxOrdinals?: number; maxAuditBytes?: number; maxInputBytes?: bigint; maxPins?: number; maxLabelChars?: number}): CurationAdmissionLimits {
        return new CurationAdmissionLimits(
            'maxOrdinals' in overrides ? overrides.maxOrdinals! : this._maxOrdinals,
            'maxAuditBytes' in overrides ? overrides.maxAuditBytes! : this._maxAuditBytes,
            'maxInputBytes' in overrides ? overrides.maxInputBytes! : this._maxInputBytes,
            'maxPins' in overrides ? overrides.maxPins! : this._maxPins,
            'maxLabelChars' in overrides ? overrides.maxLabelChars! : this._maxLabelChars
        );
    }

    public static fromPlain(obj: {maxOrdinals: number; maxAuditBytes: number; maxInputBytes: bigint; maxPins: number; maxLabelChars: number}): CurationAdmissionLimits {
        return new CurationAdmissionLimits(
            obj.maxOrdinals,
            obj.maxAuditBytes,
            obj.maxInputBytes,
            obj.maxPins,
            obj.maxLabelChars
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationAdmissionLimits.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationAdmissionLimits.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationAdmissionLimits'
    public baboonTypeIdentifier() {
        return CurationAdmissionLimits.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CurationAdmissionLimits.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CurationAdmissionLimits.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CurationAdmissionLimits.BaboonMinReaderVersions
    }
    public static jsonCodec(): CurationAdmissionLimits_JsonCodec {
        return CurationAdmissionLimits_JsonCodec.instance
    }
}

export class CurationAdmissionLimits_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationAdmissionLimits): unknown {
        if (this !== CurationAdmissionLimits_JsonCodec.lazyInstance.value) {
          return CurationAdmissionLimits_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "maxOrdinals": value.maxOrdinals,
            "maxAuditBytes": value.maxAuditBytes,
            "maxInputBytes": value.maxInputBytes.toString(),
            "maxPins": value.maxPins,
            "maxLabelChars": value.maxLabelChars,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationAdmissionLimits {
        if (this !== CurationAdmissionLimits_JsonCodec .lazyInstance.value) {
            return CurationAdmissionLimits_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CurationAdmissionLimits (
            obj["maxOrdinals"] as number,
            obj["maxAuditBytes"] as number,
            BaboonInt64.read(obj["maxInputBytes"], "i64/u64"),
            obj["maxPins"] as number,
            obj["maxLabelChars"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationAdmissionLimits_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationAdmissionLimits_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationAdmissionLimits'
    public baboonTypeIdentifier() {
        return CurationAdmissionLimits_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationAdmissionLimits_JsonCodec())
    public static get instance(): CurationAdmissionLimits_JsonCodec {
        return CurationAdmissionLimits_JsonCodec.lazyInstance.value
    }
}