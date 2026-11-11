import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class CurationRecordPin implements BaboonGeneratedLatest {
    private readonly _ref: Ref;
    private readonly _digest: string;

    constructor(ref: Ref, digest: string) {
        this._ref = ref
        this._digest = digest
    }

    public get ref(): Ref {
        return this._ref;
    }
    public get digest(): string {
        return this._digest;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ref: this._ref,
            digest: this._digest
        };
    }

    public with(overrides: {ref?: Ref; digest?: string}): CurationRecordPin {
        return new CurationRecordPin(
            'ref' in overrides ? overrides.ref! : this._ref,
            'digest' in overrides ? overrides.digest! : this._digest
        );
    }

    public static fromPlain(obj: {ref: Ref; digest: string}): CurationRecordPin {
        return new CurationRecordPin(
            obj.ref,
            obj.digest
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationRecordPin.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationRecordPin.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationRecordPin'
    public baboonTypeIdentifier() {
        return CurationRecordPin.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CurationRecordPin.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CurationRecordPin.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CurationRecordPin.BaboonMinReaderVersions
    }
    public static jsonCodec(): CurationRecordPin_JsonCodec {
        return CurationRecordPin_JsonCodec.instance
    }
}

export class CurationRecordPin_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationRecordPin): unknown {
        if (this !== CurationRecordPin_JsonCodec.lazyInstance.value) {
          return CurationRecordPin_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
            "digest": value.digest,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationRecordPin {
        if (this !== CurationRecordPin_JsonCodec .lazyInstance.value) {
            return CurationRecordPin_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CurationRecordPin (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
            obj["digest"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationRecordPin_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationRecordPin_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationRecordPin'
    public baboonTypeIdentifier() {
        return CurationRecordPin_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationRecordPin_JsonCodec())
    public static get instance(): CurationRecordPin_JsonCodec {
        return CurationRecordPin_JsonCodec.lazyInstance.value
    }
}