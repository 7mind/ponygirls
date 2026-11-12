import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {InheritanceAnchor, InheritanceAnchor_JsonCodec} from './InheritanceAnchor.js'
import {InheritanceKind, InheritanceKind_JsonCodec} from './InheritanceKind.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class ReportedInheritance implements BaboonGeneratedLatest {
    private readonly _kind: InheritanceKind;
    private readonly _sourceScope: string;
    private readonly _generation: bigint;
    private readonly _sourceFrontier: bigint;
    private readonly _coveredFrontier: bigint;
    private readonly _bindingRefs: Array<Ref>;
    private readonly _sourceRefs: Array<Ref>;
    private readonly _anchor: InheritanceAnchor | undefined;

    constructor(kind: InheritanceKind, sourceScope: string, generation: bigint, sourceFrontier: bigint, coveredFrontier: bigint, bindingRefs: Array<Ref>, sourceRefs: Array<Ref>, anchor: InheritanceAnchor | undefined) {
        this._kind = kind
        this._sourceScope = sourceScope
        this._generation = generation
        this._sourceFrontier = sourceFrontier
        this._coveredFrontier = coveredFrontier
        this._bindingRefs = bindingRefs
        this._sourceRefs = sourceRefs
        this._anchor = anchor
    }

    public get kind(): InheritanceKind {
        return this._kind;
    }
    public get sourceScope(): string {
        return this._sourceScope;
    }
    public get generation(): bigint {
        return this._generation;
    }
    public get sourceFrontier(): bigint {
        return this._sourceFrontier;
    }
    public get coveredFrontier(): bigint {
        return this._coveredFrontier;
    }
    public get bindingRefs(): Array<Ref> {
        return this._bindingRefs;
    }
    public get sourceRefs(): Array<Ref> {
        return this._sourceRefs;
    }
    public get anchor(): InheritanceAnchor | undefined {
        return this._anchor;
    }

    public toJSON(): Record<string, unknown> {
        return {
            kind: this._kind,
            sourceScope: this._sourceScope,
            generation: this._generation,
            sourceFrontier: this._sourceFrontier,
            coveredFrontier: this._coveredFrontier,
            bindingRefs: this._bindingRefs,
            sourceRefs: this._sourceRefs,
            anchor: this._anchor !== undefined ? this._anchor : undefined
        };
    }

    public with(overrides: {kind?: InheritanceKind; sourceScope?: string; generation?: bigint; sourceFrontier?: bigint; coveredFrontier?: bigint; bindingRefs?: Array<Ref>; sourceRefs?: Array<Ref>; anchor?: InheritanceAnchor | undefined}): ReportedInheritance {
        return new ReportedInheritance(
            'kind' in overrides ? overrides.kind! : this._kind,
            'sourceScope' in overrides ? overrides.sourceScope! : this._sourceScope,
            'generation' in overrides ? overrides.generation! : this._generation,
            'sourceFrontier' in overrides ? overrides.sourceFrontier! : this._sourceFrontier,
            'coveredFrontier' in overrides ? overrides.coveredFrontier! : this._coveredFrontier,
            'bindingRefs' in overrides ? overrides.bindingRefs! : this._bindingRefs,
            'sourceRefs' in overrides ? overrides.sourceRefs! : this._sourceRefs,
            'anchor' in overrides ? overrides.anchor! : this._anchor
        );
    }

    public static fromPlain(obj: {kind: InheritanceKind; sourceScope: string; generation: bigint; sourceFrontier: bigint; coveredFrontier: bigint; bindingRefs: Array<Ref>; sourceRefs: Array<Ref>; anchor: InheritanceAnchor | undefined}): ReportedInheritance {
        return new ReportedInheritance(
            obj.kind,
            obj.sourceScope,
            obj.generation,
            obj.sourceFrontier,
            obj.coveredFrontier,
            obj.bindingRefs,
            obj.sourceRefs,
            obj.anchor
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReportedInheritance.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReportedInheritance.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ReportedInheritance'
    public baboonTypeIdentifier() {
        return ReportedInheritance.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ReportedInheritance.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ReportedInheritance.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ReportedInheritance.BaboonMinReaderVersions
    }
    public static jsonCodec(): ReportedInheritance_JsonCodec {
        return ReportedInheritance_JsonCodec.instance
    }
}

export class ReportedInheritance_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ReportedInheritance): unknown {
        if (this !== ReportedInheritance_JsonCodec.lazyInstance.value) {
          return ReportedInheritance_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "kind": InheritanceKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
            "sourceScope": value.sourceScope,
            "generation": value.generation.toString(),
            "sourceFrontier": value.sourceFrontier.toString(),
            "coveredFrontier": value.coveredFrontier.toString(),
            "bindingRefs": Array.from(value.bindingRefs).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "sourceRefs": Array.from(value.sourceRefs).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "anchor": value.anchor === undefined ? null : InheritanceAnchor_JsonCodec.instance.encode(BaboonCodecContext.Default, value.anchor),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ReportedInheritance {
        if (this !== ReportedInheritance_JsonCodec .lazyInstance.value) {
            return ReportedInheritance_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ReportedInheritance (
            InheritanceKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]),
            obj["sourceScope"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
            BaboonInt64.read(obj["sourceFrontier"], "i64/u64"),
            BaboonInt64.read(obj["coveredFrontier"], "i64/u64"),
            (obj["bindingRefs"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["sourceRefs"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["anchor"] === undefined || obj["anchor"] === null ? undefined : obj["anchor"] === undefined || obj["anchor"] === null ? undefined : InheritanceAnchor_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["anchor"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReportedInheritance_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReportedInheritance_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ReportedInheritance'
    public baboonTypeIdentifier() {
        return ReportedInheritance_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ReportedInheritance_JsonCodec())
    public static get instance(): ReportedInheritance_JsonCodec {
        return ReportedInheritance_JsonCodec.lazyInstance.value
    }
}