import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Applicability, Applicability_JsonCodec} from './Applicability.js'
import {Provenance, Provenance_JsonCodec} from './Provenance.js'
import {Ref, Ref_JsonCodec} from './Ref.js'
import {RelationDetail, RelationDetail_JsonCodec} from './RelationDetail.js'
import {RelationKind, RelationKind_JsonCodec} from './RelationKind.js'
import {Standing, Standing_JsonCodec} from './Standing.js'

export class Relation implements BaboonGeneratedLatest {
    private readonly _ref: Ref;
    private readonly _scope: string;
    private readonly _applicability: Applicability;
    private readonly _kind: RelationKind;
    private readonly _sources: Array<Ref>;
    private readonly _targets: Array<Ref>;
    private readonly _detail: RelationDetail;
    private readonly _why: string;
    private readonly _standing: Standing;
    private readonly _provenance: Provenance;

    constructor(ref: Ref, scope: string, applicability: Applicability, kind: RelationKind, sources: Array<Ref>, targets: Array<Ref>, detail: RelationDetail, why: string, standing: Standing, provenance: Provenance) {
        this._ref = ref
        this._scope = scope
        this._applicability = applicability
        this._kind = kind
        this._sources = sources
        this._targets = targets
        this._detail = detail
        this._why = why
        this._standing = standing
        this._provenance = provenance
    }

    public get ref(): Ref {
        return this._ref;
    }
    public get scope(): string {
        return this._scope;
    }
    public get applicability(): Applicability {
        return this._applicability;
    }
    public get kind(): RelationKind {
        return this._kind;
    }
    public get sources(): Array<Ref> {
        return this._sources;
    }
    public get targets(): Array<Ref> {
        return this._targets;
    }
    public get detail(): RelationDetail {
        return this._detail;
    }
    public get why(): string {
        return this._why;
    }
    public get standing(): Standing {
        return this._standing;
    }
    public get provenance(): Provenance {
        return this._provenance;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ref: this._ref,
            scope: this._scope,
            applicability: this._applicability,
            kind: this._kind,
            sources: this._sources,
            targets: this._targets,
            detail: this._detail,
            why: this._why,
            standing: this._standing,
            provenance: this._provenance
        };
    }

    public with(overrides: {ref?: Ref; scope?: string; applicability?: Applicability; kind?: RelationKind; sources?: Array<Ref>; targets?: Array<Ref>; detail?: RelationDetail; why?: string; standing?: Standing; provenance?: Provenance}): Relation {
        return new Relation(
            'ref' in overrides ? overrides.ref! : this._ref,
            'scope' in overrides ? overrides.scope! : this._scope,
            'applicability' in overrides ? overrides.applicability! : this._applicability,
            'kind' in overrides ? overrides.kind! : this._kind,
            'sources' in overrides ? overrides.sources! : this._sources,
            'targets' in overrides ? overrides.targets! : this._targets,
            'detail' in overrides ? overrides.detail! : this._detail,
            'why' in overrides ? overrides.why! : this._why,
            'standing' in overrides ? overrides.standing! : this._standing,
            'provenance' in overrides ? overrides.provenance! : this._provenance
        );
    }

    public static fromPlain(obj: {ref: Ref; scope: string; applicability: Applicability; kind: RelationKind; sources: Array<Ref>; targets: Array<Ref>; detail: RelationDetail; why: string; standing: Standing; provenance: Provenance}): Relation {
        return new Relation(
            obj.ref,
            obj.scope,
            obj.applicability,
            obj.kind,
            obj.sources,
            obj.targets,
            obj.detail,
            obj.why,
            obj.standing,
            obj.provenance
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Relation.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Relation.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Relation'
    public baboonTypeIdentifier() {
        return Relation.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Relation.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Relation.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Relation.BaboonMinReaderVersions
    }
    public static jsonCodec(): Relation_JsonCodec {
        return Relation_JsonCodec.instance
    }
}

export class Relation_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Relation): unknown {
        if (this !== Relation_JsonCodec.lazyInstance.value) {
          return Relation_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
            "scope": value.scope,
            "applicability": Applicability_JsonCodec.instance.encode(BaboonCodecContext.Default, value.applicability),
            "kind": RelationKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
            "sources": Array.from(value.sources).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "targets": Array.from(value.targets).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "detail": RelationDetail_JsonCodec.instance.encode(BaboonCodecContext.Default, value.detail),
            "why": value.why,
            "standing": Standing_JsonCodec.instance.encode(BaboonCodecContext.Default, value.standing),
            "provenance": Provenance_JsonCodec.instance.encode(BaboonCodecContext.Default, value.provenance),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Relation {
        if (this !== Relation_JsonCodec .lazyInstance.value) {
            return Relation_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Relation (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
            obj["scope"] as string,
            Applicability_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["applicability"]),
            RelationKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]),
            (obj["sources"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["targets"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            RelationDetail_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["detail"]),
            obj["why"] as string,
            Standing_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["standing"]),
            Provenance_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["provenance"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Relation_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Relation_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Relation'
    public baboonTypeIdentifier() {
        return Relation_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Relation_JsonCodec())
    public static get instance(): Relation_JsonCodec {
        return Relation_JsonCodec.lazyInstance.value
    }
}