import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class GateBasis implements BaboonGeneratedLatest {
    private readonly _references: Array<Ref>;
    private readonly _selectionWitnesses: Array<Ref>;

    constructor(references: Array<Ref>, selectionWitnesses: Array<Ref>) {
        this._references = references
        this._selectionWitnesses = selectionWitnesses
    }

    public get references(): Array<Ref> {
        return this._references;
    }
    public get selectionWitnesses(): Array<Ref> {
        return this._selectionWitnesses;
    }

    public toJSON(): Record<string, unknown> {
        return {
            references: this._references,
            selectionWitnesses: this._selectionWitnesses
        };
    }

    public with(overrides: {references?: Array<Ref>; selectionWitnesses?: Array<Ref>}): GateBasis {
        return new GateBasis(
            'references' in overrides ? overrides.references! : this._references,
            'selectionWitnesses' in overrides ? overrides.selectionWitnesses! : this._selectionWitnesses
        );
    }

    public static fromPlain(obj: {references: Array<Ref>; selectionWitnesses: Array<Ref>}): GateBasis {
        return new GateBasis(
            obj.references,
            obj.selectionWitnesses
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GateBasis.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GateBasis.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#GateBasis'
    public baboonTypeIdentifier() {
        return GateBasis.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return GateBasis.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return GateBasis.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return GateBasis.BaboonMinReaderVersions
    }
    public static jsonCodec(): GateBasis_JsonCodec {
        return GateBasis_JsonCodec.instance
    }
}

export class GateBasis_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GateBasis): unknown {
        if (this !== GateBasis_JsonCodec.lazyInstance.value) {
          return GateBasis_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "references": Array.from(value.references).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "selectionWitnesses": Array.from(value.selectionWitnesses).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GateBasis {
        if (this !== GateBasis_JsonCodec .lazyInstance.value) {
            return GateBasis_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new GateBasis (
            (obj["references"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["selectionWitnesses"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GateBasis_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GateBasis_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#GateBasis'
    public baboonTypeIdentifier() {
        return GateBasis_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GateBasis_JsonCodec())
    public static get instance(): GateBasis_JsonCodec {
        return GateBasis_JsonCodec.lazyInstance.value
    }
}