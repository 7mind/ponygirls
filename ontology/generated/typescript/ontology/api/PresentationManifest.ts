import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {PresentedSelection, PresentedSelection_JsonCodec} from './PresentedSelection.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class PresentationManifest implements BaboonGeneratedLatest {
    private readonly _choices: Array<PresentedSelection>;
    private readonly _adoptionTargets: Array<Ref>;

    constructor(choices: Array<PresentedSelection>, adoptionTargets: Array<Ref>) {
        this._choices = choices
        this._adoptionTargets = adoptionTargets
    }

    public get choices(): Array<PresentedSelection> {
        return this._choices;
    }
    public get adoptionTargets(): Array<Ref> {
        return this._adoptionTargets;
    }

    public toJSON(): Record<string, unknown> {
        return {
            choices: this._choices,
            adoptionTargets: this._adoptionTargets
        };
    }

    public with(overrides: {choices?: Array<PresentedSelection>; adoptionTargets?: Array<Ref>}): PresentationManifest {
        return new PresentationManifest(
            'choices' in overrides ? overrides.choices! : this._choices,
            'adoptionTargets' in overrides ? overrides.adoptionTargets! : this._adoptionTargets
        );
    }

    public static fromPlain(obj: {choices: Array<PresentedSelection>; adoptionTargets: Array<Ref>}): PresentationManifest {
        return new PresentationManifest(
            obj.choices,
            obj.adoptionTargets
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentationManifest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentationManifest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#PresentationManifest'
    public baboonTypeIdentifier() {
        return PresentationManifest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return PresentationManifest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return PresentationManifest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return PresentationManifest.BaboonMinReaderVersions
    }
    public static jsonCodec(): PresentationManifest_JsonCodec {
        return PresentationManifest_JsonCodec.instance
    }
}

export class PresentationManifest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PresentationManifest): unknown {
        if (this !== PresentationManifest_JsonCodec.lazyInstance.value) {
          return PresentationManifest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "choices": Array.from(value.choices).map(item => PresentedSelection_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "adoptionTargets": Array.from(value.adoptionTargets).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PresentationManifest {
        if (this !== PresentationManifest_JsonCodec .lazyInstance.value) {
            return PresentationManifest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new PresentationManifest (
            (obj["choices"] as unknown[]).map(item => PresentedSelection_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["adoptionTargets"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentationManifest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentationManifest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#PresentationManifest'
    public baboonTypeIdentifier() {
        return PresentationManifest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PresentationManifest_JsonCodec())
    public static get instance(): PresentationManifest_JsonCodec {
        return PresentationManifest_JsonCodec.lazyInstance.value
    }
}