import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ApplicabilityInput, ApplicabilityInput_JsonCodec} from './ApplicabilityInput.js'
import {ContentInput, ContentInput_JsonCodec} from './ContentInput.js'
import {Phase, Phase_JsonCodec} from './Phase.js'
import {Ref, Ref_JsonCodec} from './Ref.js'
import {RelationDetailInput, RelationDetailInput_JsonCodec} from './RelationDetailInput.js'
import {RelationKind, RelationKind_JsonCodec} from './RelationKind.js'
import {Resolution, Resolution_JsonCodec} from './Resolution.js'
import {Standing, Standing_JsonCodec} from './Standing.js'
import {Target, Target_JsonCodec} from './Target.js'

export type Operation = Operation_Create | Operation_Revise | Operation_Relate | Operation_ReviseRelation | Operation_Bind | Operation_State

export const Operation = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#Operation',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#Operation',
    jsonCodec(): Operation_JsonCodec {
        return Operation_JsonCodec.instance
    }
} as const

export class Operation_Create implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Operation]#Create' as const;
    private readonly _alias: string;
    private readonly _applicability: ApplicabilityInput;
    private readonly _content: ContentInput;
    private readonly _basis: Array<Target>;

    constructor(alias: string, applicability: ApplicabilityInput, content: ContentInput, basis: Array<Target>) {
        this._alias = alias
        this._applicability = applicability
        this._content = content
        this._basis = basis
    }

    public get alias(): string {
        return this._alias;
    }
    public get applicability(): ApplicabilityInput {
        return this._applicability;
    }
    public get content(): ContentInput {
        return this._content;
    }
    public get basis(): Array<Target> {
        return this._basis;
    }

    public toJSON(): Record<string, unknown> {
        return {
            alias: this._alias,
            applicability: this._applicability,
            content: this._content,
            basis: this._basis
        };
    }

    public with(overrides: {alias?: string; applicability?: ApplicabilityInput; content?: ContentInput; basis?: Array<Target>}): Operation_Create {
        return new Operation_Create(
            'alias' in overrides ? overrides.alias! : this._alias,
            'applicability' in overrides ? overrides.applicability! : this._applicability,
            'content' in overrides ? overrides.content! : this._content,
            'basis' in overrides ? overrides.basis! : this._basis
        );
    }

    public static fromPlain(obj: {alias: string; applicability: ApplicabilityInput; content: ContentInput; basis: Array<Target>}): Operation_Create {
        return new Operation_Create(
            obj.alias,
            obj.applicability,
            obj.content,
            obj.basis
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Operation_Create.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Operation_Create.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Operation]#Create'
    public baboonTypeIdentifier() {
        return Operation_Create.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Operation_Create.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Create.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Operation_Create.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Create.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Create_JsonCodec {
        return Operation_Create_JsonCodec.instance
    }
}

export class Operation_Create_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Create): unknown {
        if (this !== Operation_Create_JsonCodec.lazyInstance.value) {
          return Operation_Create_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "alias": value.alias,
            "applicability": ApplicabilityInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.applicability),
            "content": ContentInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.content),
            "basis": Array.from(value.basis).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Create {
        if (this !== Operation_Create_JsonCodec .lazyInstance.value) {
            return Operation_Create_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Create (
            obj["alias"] as string,
            ApplicabilityInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["applicability"]),
            ContentInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["content"]),
            (obj["basis"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Operation_Create_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Operation_Create_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Operation]#Create'
    public baboonTypeIdentifier() {
        return Operation_Create_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Create_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Create_JsonCodec())
    public static get instance(): Operation_Create_JsonCodec {
        return Operation_Create_JsonCodec.lazyInstance.value
    }
}

export class Operation_Revise implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Operation]#Revise' as const;
    private readonly _alias: string;
    private readonly _ref: Ref;
    private readonly _applicability: ApplicabilityInput;
    private readonly _content: ContentInput;
    private readonly _standing: Standing;
    private readonly _basis: Array<Target>;
    private readonly _reason: string;

    constructor(alias: string, ref: Ref, applicability: ApplicabilityInput, content: ContentInput, standing: Standing, basis: Array<Target>, reason: string) {
        this._alias = alias
        this._ref = ref
        this._applicability = applicability
        this._content = content
        this._standing = standing
        this._basis = basis
        this._reason = reason
    }

    public get alias(): string {
        return this._alias;
    }
    public get ref(): Ref {
        return this._ref;
    }
    public get applicability(): ApplicabilityInput {
        return this._applicability;
    }
    public get content(): ContentInput {
        return this._content;
    }
    public get standing(): Standing {
        return this._standing;
    }
    public get basis(): Array<Target> {
        return this._basis;
    }
    public get reason(): string {
        return this._reason;
    }

    public toJSON(): Record<string, unknown> {
        return {
            alias: this._alias,
            ref: this._ref,
            applicability: this._applicability,
            content: this._content,
            standing: this._standing,
            basis: this._basis,
            reason: this._reason
        };
    }

    public with(overrides: {alias?: string; ref?: Ref; applicability?: ApplicabilityInput; content?: ContentInput; standing?: Standing; basis?: Array<Target>; reason?: string}): Operation_Revise {
        return new Operation_Revise(
            'alias' in overrides ? overrides.alias! : this._alias,
            'ref' in overrides ? overrides.ref! : this._ref,
            'applicability' in overrides ? overrides.applicability! : this._applicability,
            'content' in overrides ? overrides.content! : this._content,
            'standing' in overrides ? overrides.standing! : this._standing,
            'basis' in overrides ? overrides.basis! : this._basis,
            'reason' in overrides ? overrides.reason! : this._reason
        );
    }

    public static fromPlain(obj: {alias: string; ref: Ref; applicability: ApplicabilityInput; content: ContentInput; standing: Standing; basis: Array<Target>; reason: string}): Operation_Revise {
        return new Operation_Revise(
            obj.alias,
            obj.ref,
            obj.applicability,
            obj.content,
            obj.standing,
            obj.basis,
            obj.reason
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Operation_Revise.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Operation_Revise.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Operation]#Revise'
    public baboonTypeIdentifier() {
        return Operation_Revise.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Operation_Revise.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Revise.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Operation_Revise.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Revise.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Revise_JsonCodec {
        return Operation_Revise_JsonCodec.instance
    }
}

export class Operation_Revise_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Revise): unknown {
        if (this !== Operation_Revise_JsonCodec.lazyInstance.value) {
          return Operation_Revise_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "alias": value.alias,
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
            "applicability": ApplicabilityInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.applicability),
            "content": ContentInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.content),
            "standing": Standing_JsonCodec.instance.encode(BaboonCodecContext.Default, value.standing),
            "basis": Array.from(value.basis).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "reason": value.reason,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Revise {
        if (this !== Operation_Revise_JsonCodec .lazyInstance.value) {
            return Operation_Revise_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Revise (
            obj["alias"] as string,
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
            ApplicabilityInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["applicability"]),
            ContentInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["content"]),
            Standing_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["standing"]),
            (obj["basis"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["reason"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Operation_Revise_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Operation_Revise_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Operation]#Revise'
    public baboonTypeIdentifier() {
        return Operation_Revise_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Revise_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Revise_JsonCodec())
    public static get instance(): Operation_Revise_JsonCodec {
        return Operation_Revise_JsonCodec.lazyInstance.value
    }
}

export class Operation_Relate implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Operation]#Relate' as const;
    private readonly _alias: string;
    private readonly _applicability: ApplicabilityInput;
    private readonly _kind: RelationKind;
    private readonly _sources: Array<Target>;
    private readonly _targets: Array<Target>;
    private readonly _detail: RelationDetailInput;
    private readonly _why: string;

    constructor(alias: string, applicability: ApplicabilityInput, kind: RelationKind, sources: Array<Target>, targets: Array<Target>, detail: RelationDetailInput, why: string) {
        this._alias = alias
        this._applicability = applicability
        this._kind = kind
        this._sources = sources
        this._targets = targets
        this._detail = detail
        this._why = why
    }

    public get alias(): string {
        return this._alias;
    }
    public get applicability(): ApplicabilityInput {
        return this._applicability;
    }
    public get kind(): RelationKind {
        return this._kind;
    }
    public get sources(): Array<Target> {
        return this._sources;
    }
    public get targets(): Array<Target> {
        return this._targets;
    }
    public get detail(): RelationDetailInput {
        return this._detail;
    }
    public get why(): string {
        return this._why;
    }

    public toJSON(): Record<string, unknown> {
        return {
            alias: this._alias,
            applicability: this._applicability,
            kind: this._kind,
            sources: this._sources,
            targets: this._targets,
            detail: this._detail,
            why: this._why
        };
    }

    public with(overrides: {alias?: string; applicability?: ApplicabilityInput; kind?: RelationKind; sources?: Array<Target>; targets?: Array<Target>; detail?: RelationDetailInput; why?: string}): Operation_Relate {
        return new Operation_Relate(
            'alias' in overrides ? overrides.alias! : this._alias,
            'applicability' in overrides ? overrides.applicability! : this._applicability,
            'kind' in overrides ? overrides.kind! : this._kind,
            'sources' in overrides ? overrides.sources! : this._sources,
            'targets' in overrides ? overrides.targets! : this._targets,
            'detail' in overrides ? overrides.detail! : this._detail,
            'why' in overrides ? overrides.why! : this._why
        );
    }

    public static fromPlain(obj: {alias: string; applicability: ApplicabilityInput; kind: RelationKind; sources: Array<Target>; targets: Array<Target>; detail: RelationDetailInput; why: string}): Operation_Relate {
        return new Operation_Relate(
            obj.alias,
            obj.applicability,
            obj.kind,
            obj.sources,
            obj.targets,
            obj.detail,
            obj.why
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Operation_Relate.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Operation_Relate.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Operation]#Relate'
    public baboonTypeIdentifier() {
        return Operation_Relate.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Operation_Relate.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Relate.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Operation_Relate.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Relate.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Relate_JsonCodec {
        return Operation_Relate_JsonCodec.instance
    }
}

export class Operation_Relate_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Relate): unknown {
        if (this !== Operation_Relate_JsonCodec.lazyInstance.value) {
          return Operation_Relate_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "alias": value.alias,
            "applicability": ApplicabilityInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.applicability),
            "kind": RelationKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
            "sources": Array.from(value.sources).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "targets": Array.from(value.targets).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "detail": RelationDetailInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.detail),
            "why": value.why,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Relate {
        if (this !== Operation_Relate_JsonCodec .lazyInstance.value) {
            return Operation_Relate_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Relate (
            obj["alias"] as string,
            ApplicabilityInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["applicability"]),
            RelationKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]),
            (obj["sources"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["targets"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            RelationDetailInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["detail"]),
            obj["why"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Operation_Relate_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Operation_Relate_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Operation]#Relate'
    public baboonTypeIdentifier() {
        return Operation_Relate_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Relate_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Relate_JsonCodec())
    public static get instance(): Operation_Relate_JsonCodec {
        return Operation_Relate_JsonCodec.lazyInstance.value
    }
}

export class Operation_ReviseRelation implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Operation]#ReviseRelation' as const;
    private readonly _alias: string;
    private readonly _ref: Ref;
    private readonly _applicability: ApplicabilityInput;
    private readonly _sources: Array<Target>;
    private readonly _targets: Array<Target>;
    private readonly _detail: RelationDetailInput;
    private readonly _why: string;
    private readonly _standing: Standing;

    constructor(alias: string, ref: Ref, applicability: ApplicabilityInput, sources: Array<Target>, targets: Array<Target>, detail: RelationDetailInput, why: string, standing: Standing) {
        this._alias = alias
        this._ref = ref
        this._applicability = applicability
        this._sources = sources
        this._targets = targets
        this._detail = detail
        this._why = why
        this._standing = standing
    }

    public get alias(): string {
        return this._alias;
    }
    public get ref(): Ref {
        return this._ref;
    }
    public get applicability(): ApplicabilityInput {
        return this._applicability;
    }
    public get sources(): Array<Target> {
        return this._sources;
    }
    public get targets(): Array<Target> {
        return this._targets;
    }
    public get detail(): RelationDetailInput {
        return this._detail;
    }
    public get why(): string {
        return this._why;
    }
    public get standing(): Standing {
        return this._standing;
    }

    public toJSON(): Record<string, unknown> {
        return {
            alias: this._alias,
            ref: this._ref,
            applicability: this._applicability,
            sources: this._sources,
            targets: this._targets,
            detail: this._detail,
            why: this._why,
            standing: this._standing
        };
    }

    public with(overrides: {alias?: string; ref?: Ref; applicability?: ApplicabilityInput; sources?: Array<Target>; targets?: Array<Target>; detail?: RelationDetailInput; why?: string; standing?: Standing}): Operation_ReviseRelation {
        return new Operation_ReviseRelation(
            'alias' in overrides ? overrides.alias! : this._alias,
            'ref' in overrides ? overrides.ref! : this._ref,
            'applicability' in overrides ? overrides.applicability! : this._applicability,
            'sources' in overrides ? overrides.sources! : this._sources,
            'targets' in overrides ? overrides.targets! : this._targets,
            'detail' in overrides ? overrides.detail! : this._detail,
            'why' in overrides ? overrides.why! : this._why,
            'standing' in overrides ? overrides.standing! : this._standing
        );
    }

    public static fromPlain(obj: {alias: string; ref: Ref; applicability: ApplicabilityInput; sources: Array<Target>; targets: Array<Target>; detail: RelationDetailInput; why: string; standing: Standing}): Operation_ReviseRelation {
        return new Operation_ReviseRelation(
            obj.alias,
            obj.ref,
            obj.applicability,
            obj.sources,
            obj.targets,
            obj.detail,
            obj.why,
            obj.standing
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Operation_ReviseRelation.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Operation_ReviseRelation.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Operation]#ReviseRelation'
    public baboonTypeIdentifier() {
        return Operation_ReviseRelation.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Operation_ReviseRelation.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Operation_ReviseRelation.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Operation_ReviseRelation.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_ReviseRelation.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_ReviseRelation_JsonCodec {
        return Operation_ReviseRelation_JsonCodec.instance
    }
}

export class Operation_ReviseRelation_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_ReviseRelation): unknown {
        if (this !== Operation_ReviseRelation_JsonCodec.lazyInstance.value) {
          return Operation_ReviseRelation_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "alias": value.alias,
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
            "applicability": ApplicabilityInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.applicability),
            "sources": Array.from(value.sources).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "targets": Array.from(value.targets).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "detail": RelationDetailInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.detail),
            "why": value.why,
            "standing": Standing_JsonCodec.instance.encode(BaboonCodecContext.Default, value.standing),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_ReviseRelation {
        if (this !== Operation_ReviseRelation_JsonCodec .lazyInstance.value) {
            return Operation_ReviseRelation_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_ReviseRelation (
            obj["alias"] as string,
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
            ApplicabilityInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["applicability"]),
            (obj["sources"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["targets"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            RelationDetailInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["detail"]),
            obj["why"] as string,
            Standing_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["standing"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Operation_ReviseRelation_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Operation_ReviseRelation_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Operation]#ReviseRelation'
    public baboonTypeIdentifier() {
        return Operation_ReviseRelation_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_ReviseRelation_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_ReviseRelation_JsonCodec())
    public static get instance(): Operation_ReviseRelation_JsonCodec {
        return Operation_ReviseRelation_JsonCodec.lazyInstance.value
    }
}

export class Operation_Bind implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Operation]#Bind' as const;
    private readonly _alias: string;
    private readonly _definition: Target;
    private readonly _context: Array<Target>;

    constructor(alias: string, definition: Target, context: Array<Target>) {
        this._alias = alias
        this._definition = definition
        this._context = context
    }

    public get alias(): string {
        return this._alias;
    }
    public get definition(): Target {
        return this._definition;
    }
    public get context(): Array<Target> {
        return this._context;
    }

    public toJSON(): Record<string, unknown> {
        return {
            alias: this._alias,
            definition: this._definition,
            context: this._context
        };
    }

    public with(overrides: {alias?: string; definition?: Target; context?: Array<Target>}): Operation_Bind {
        return new Operation_Bind(
            'alias' in overrides ? overrides.alias! : this._alias,
            'definition' in overrides ? overrides.definition! : this._definition,
            'context' in overrides ? overrides.context! : this._context
        );
    }

    public static fromPlain(obj: {alias: string; definition: Target; context: Array<Target>}): Operation_Bind {
        return new Operation_Bind(
            obj.alias,
            obj.definition,
            obj.context
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Operation_Bind.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Operation_Bind.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Operation]#Bind'
    public baboonTypeIdentifier() {
        return Operation_Bind.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Operation_Bind.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Operation_Bind.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Operation_Bind.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Bind.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_Bind_JsonCodec {
        return Operation_Bind_JsonCodec.instance
    }
}

export class Operation_Bind_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_Bind): unknown {
        if (this !== Operation_Bind_JsonCodec.lazyInstance.value) {
          return Operation_Bind_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "alias": value.alias,
            "definition": Target_JsonCodec.instance.encode(BaboonCodecContext.Default, value.definition),
            "context": Array.from(value.context).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_Bind {
        if (this !== Operation_Bind_JsonCodec .lazyInstance.value) {
            return Operation_Bind_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_Bind (
            obj["alias"] as string,
            Target_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["definition"]),
            (obj["context"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Operation_Bind_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Operation_Bind_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Operation]#Bind'
    public baboonTypeIdentifier() {
        return Operation_Bind_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_Bind_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_Bind_JsonCodec())
    public static get instance(): Operation_Bind_JsonCodec {
        return Operation_Bind_JsonCodec.lazyInstance.value
    }
}

export class Operation_State implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Operation]#State' as const;
    private readonly _alias: string;
    private readonly _subject: Target;
    private readonly _previous: Ref | undefined;
    private readonly _phase: Phase;
    private readonly _result: Resolution | undefined;
    private readonly _resolution: string | undefined;
    private readonly _evidence: Array<Target>;
    private readonly _uncertainty: string;

    constructor(alias: string, subject: Target, previous: Ref | undefined, phase: Phase, result: Resolution | undefined, resolution: string | undefined, evidence: Array<Target>, uncertainty: string) {
        this._alias = alias
        this._subject = subject
        this._previous = previous
        this._phase = phase
        this._result = result
        this._resolution = resolution
        this._evidence = evidence
        this._uncertainty = uncertainty
    }

    public get alias(): string {
        return this._alias;
    }
    public get subject(): Target {
        return this._subject;
    }
    public get previous(): Ref | undefined {
        return this._previous;
    }
    public get phase(): Phase {
        return this._phase;
    }
    public get result(): Resolution | undefined {
        return this._result;
    }
    public get resolution(): string | undefined {
        return this._resolution;
    }
    public get evidence(): Array<Target> {
        return this._evidence;
    }
    public get uncertainty(): string {
        return this._uncertainty;
    }

    public toJSON(): Record<string, unknown> {
        return {
            alias: this._alias,
            subject: this._subject,
            previous: this._previous !== undefined ? this._previous : undefined,
            phase: this._phase,
            result: this._result !== undefined ? this._result : undefined,
            resolution: this._resolution !== undefined ? this._resolution : undefined,
            evidence: this._evidence,
            uncertainty: this._uncertainty
        };
    }

    public with(overrides: {alias?: string; subject?: Target; previous?: Ref | undefined; phase?: Phase; result?: Resolution | undefined; resolution?: string | undefined; evidence?: Array<Target>; uncertainty?: string}): Operation_State {
        return new Operation_State(
            'alias' in overrides ? overrides.alias! : this._alias,
            'subject' in overrides ? overrides.subject! : this._subject,
            'previous' in overrides ? overrides.previous! : this._previous,
            'phase' in overrides ? overrides.phase! : this._phase,
            'result' in overrides ? overrides.result! : this._result,
            'resolution' in overrides ? overrides.resolution! : this._resolution,
            'evidence' in overrides ? overrides.evidence! : this._evidence,
            'uncertainty' in overrides ? overrides.uncertainty! : this._uncertainty
        );
    }

    public static fromPlain(obj: {alias: string; subject: Target; previous: Ref | undefined; phase: Phase; result: Resolution | undefined; resolution: string | undefined; evidence: Array<Target>; uncertainty: string}): Operation_State {
        return new Operation_State(
            obj.alias,
            obj.subject,
            obj.previous,
            obj.phase,
            obj.result,
            obj.resolution,
            obj.evidence,
            obj.uncertainty
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Operation_State.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Operation_State.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Operation]#State'
    public baboonTypeIdentifier() {
        return Operation_State.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Operation_State.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Operation_State.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Operation_State.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_State.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Operation_State_JsonCodec {
        return Operation_State_JsonCodec.instance
    }
}

export class Operation_State_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation_State): unknown {
        if (this !== Operation_State_JsonCodec.lazyInstance.value) {
          return Operation_State_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "alias": value.alias,
            "subject": Target_JsonCodec.instance.encode(BaboonCodecContext.Default, value.subject),
            "previous": value.previous === undefined ? null : Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.previous),
            "phase": Phase_JsonCodec.instance.encode(BaboonCodecContext.Default, value.phase),
            "result": value.result === undefined ? null : Resolution_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
            "resolution": value.resolution === undefined ? null : value.resolution,
            "evidence": Array.from(value.evidence).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "uncertainty": value.uncertainty,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation_State {
        if (this !== Operation_State_JsonCodec .lazyInstance.value) {
            return Operation_State_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Operation_State (
            obj["alias"] as string,
            Target_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["subject"]),
            obj["previous"] === undefined || obj["previous"] === null ? undefined : obj["previous"] === undefined || obj["previous"] === null ? undefined : Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["previous"]),
            Phase_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["phase"]),
            obj["result"] === undefined || obj["result"] === null ? undefined : obj["result"] === undefined || obj["result"] === null ? undefined : Resolution_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
            obj["resolution"] === undefined || obj["resolution"] === null ? undefined : obj["resolution"] === undefined || obj["resolution"] === null ? undefined : obj["resolution"] as string,
            (obj["evidence"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["uncertainty"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Operation_State_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Operation_State_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Operation]#State'
    public baboonTypeIdentifier() {
        return Operation_State_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_State_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_State_JsonCodec())
    public static get instance(): Operation_State_JsonCodec {
        return Operation_State_JsonCodec.lazyInstance.value
    }
}


export class Operation_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Operation): unknown {
        if (this !== Operation_JsonCodec.lazyInstance.value) {
          return Operation_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof Operation_Create) {
                return { "Create": Operation_Create_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_Revise) {
                return { "Revise": Operation_Revise_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_Relate) {
                return { "Relate": Operation_Relate_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_ReviseRelation) {
                return { "ReviseRelation": Operation_ReviseRelation_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_Bind) {
                return { "Bind": Operation_Bind_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Operation_State) {
                return { "State": Operation_State_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Operation {
        if (this !== Operation_JsonCodec .lazyInstance.value) {
            return Operation_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Create": return Operation_Create_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Revise": return Operation_Revise_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Relate": return Operation_Relate_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ReviseRelation": return Operation_ReviseRelation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Bind": return Operation_Bind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "State": return Operation_State_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Operation_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Operation_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Operation'
    public baboonTypeIdentifier() {
        return Operation_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Operation'
    public baboonAdtTypeIdentifier() {
        return Operation_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Operation_JsonCodec())
    public static get instance(): Operation_JsonCodec {
        return Operation_JsonCodec.lazyInstance.value
    }
}