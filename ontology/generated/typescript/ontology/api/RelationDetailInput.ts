import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {AdoptionOrigin, AdoptionOrigin_JsonCodec} from './AdoptionOrigin.js'
import {AssessmentUseDisposition, AssessmentUseDisposition_JsonCodec} from './AssessmentUseDisposition.js'
import {Consumption, Consumption_JsonCodec} from './Consumption.js'
import {Gate, Gate_JsonCodec} from './Gate.js'
import {Grouping, Grouping_JsonCodec} from './Grouping.js'
import {Target, Target_JsonCodec} from './Target.js'

export type RelationDetailInput = RelationDetailInput_Empty | RelationDetailInput_Dependency | RelationDetailInput_Decomposition | RelationDetailInput_Delegation | RelationDetailInput_Adoption | RelationDetailInput_AssessmentUse

export const RelationDetailInput = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#RelationDetailInput',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#RelationDetailInput',
    jsonCodec(): RelationDetailInput_JsonCodec {
        return RelationDetailInput_JsonCodec.instance
    }
} as const

export class RelationDetailInput_Empty implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#RelationDetailInput]#Empty' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): RelationDetailInput_Empty {
        return new RelationDetailInput_Empty(
            
        );
    }

    public static fromPlain(obj: {}): RelationDetailInput_Empty {
        return new RelationDetailInput_Empty(
            
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetailInput_Empty.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetailInput_Empty.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetailInput]#Empty'
    public baboonTypeIdentifier() {
        return RelationDetailInput_Empty.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RelationDetailInput_Empty.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RelationDetailInput_Empty.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RelationDetailInput_Empty.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetailInput'
    public baboonAdtTypeIdentifier() {
        return RelationDetailInput_Empty.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): RelationDetailInput_Empty_JsonCodec {
        return RelationDetailInput_Empty_JsonCodec.instance
    }
}

export class RelationDetailInput_Empty_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationDetailInput_Empty): unknown {
        if (this !== RelationDetailInput_Empty_JsonCodec.lazyInstance.value) {
          return RelationDetailInput_Empty_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationDetailInput_Empty {
        if (this !== RelationDetailInput_Empty_JsonCodec .lazyInstance.value) {
            return RelationDetailInput_Empty_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RelationDetailInput_Empty (
            
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetailInput_Empty_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetailInput_Empty_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetailInput]#Empty'
    public baboonTypeIdentifier() {
        return RelationDetailInput_Empty_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetailInput'
    public baboonAdtTypeIdentifier() {
        return RelationDetailInput_Empty_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationDetailInput_Empty_JsonCodec())
    public static get instance(): RelationDetailInput_Empty_JsonCodec {
        return RelationDetailInput_Empty_JsonCodec.lazyInstance.value
    }
}

export class RelationDetailInput_Dependency implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#RelationDetailInput]#Dependency' as const;
    private readonly _gate: Gate;
    private readonly _consumption: Consumption;
    private readonly _event: Target | undefined;
    private readonly _applicability: string;

    constructor(gate: Gate, consumption: Consumption, event: Target | undefined, applicability: string) {
        this._gate = gate
        this._consumption = consumption
        this._event = event
        this._applicability = applicability
    }

    public get gate(): Gate {
        return this._gate;
    }
    public get consumption(): Consumption {
        return this._consumption;
    }
    public get event(): Target | undefined {
        return this._event;
    }
    public get applicability(): string {
        return this._applicability;
    }

    public toJSON(): Record<string, unknown> {
        return {
            gate: this._gate,
            consumption: this._consumption,
            event: this._event !== undefined ? this._event : undefined,
            applicability: this._applicability
        };
    }

    public with(overrides: {gate?: Gate; consumption?: Consumption; event?: Target | undefined; applicability?: string}): RelationDetailInput_Dependency {
        return new RelationDetailInput_Dependency(
            'gate' in overrides ? overrides.gate! : this._gate,
            'consumption' in overrides ? overrides.consumption! : this._consumption,
            'event' in overrides ? overrides.event! : this._event,
            'applicability' in overrides ? overrides.applicability! : this._applicability
        );
    }

    public static fromPlain(obj: {gate: Gate; consumption: Consumption; event: Target | undefined; applicability: string}): RelationDetailInput_Dependency {
        return new RelationDetailInput_Dependency(
            obj.gate,
            obj.consumption,
            obj.event,
            obj.applicability
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetailInput_Dependency.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetailInput_Dependency.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetailInput]#Dependency'
    public baboonTypeIdentifier() {
        return RelationDetailInput_Dependency.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RelationDetailInput_Dependency.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RelationDetailInput_Dependency.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RelationDetailInput_Dependency.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetailInput'
    public baboonAdtTypeIdentifier() {
        return RelationDetailInput_Dependency.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): RelationDetailInput_Dependency_JsonCodec {
        return RelationDetailInput_Dependency_JsonCodec.instance
    }
}

export class RelationDetailInput_Dependency_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationDetailInput_Dependency): unknown {
        if (this !== RelationDetailInput_Dependency_JsonCodec.lazyInstance.value) {
          return RelationDetailInput_Dependency_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "gate": Gate_JsonCodec.instance.encode(BaboonCodecContext.Default, value.gate),
            "consumption": Consumption_JsonCodec.instance.encode(BaboonCodecContext.Default, value.consumption),
            "event": value.event === undefined ? null : Target_JsonCodec.instance.encode(BaboonCodecContext.Default, value.event),
            "applicability": value.applicability,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationDetailInput_Dependency {
        if (this !== RelationDetailInput_Dependency_JsonCodec .lazyInstance.value) {
            return RelationDetailInput_Dependency_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RelationDetailInput_Dependency (
            Gate_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["gate"]),
            Consumption_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["consumption"]),
            obj["event"] === undefined || obj["event"] === null ? undefined : obj["event"] === undefined || obj["event"] === null ? undefined : Target_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["event"]),
            obj["applicability"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetailInput_Dependency_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetailInput_Dependency_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetailInput]#Dependency'
    public baboonTypeIdentifier() {
        return RelationDetailInput_Dependency_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetailInput'
    public baboonAdtTypeIdentifier() {
        return RelationDetailInput_Dependency_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationDetailInput_Dependency_JsonCodec())
    public static get instance(): RelationDetailInput_Dependency_JsonCodec {
        return RelationDetailInput_Dependency_JsonCodec.lazyInstance.value
    }
}

export class RelationDetailInput_Decomposition implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#RelationDetailInput]#Decomposition' as const;
    private readonly _grouping: Grouping;

    constructor(grouping: Grouping) {
        this._grouping = grouping
    }

    public get grouping(): Grouping {
        return this._grouping;
    }

    public toJSON(): Record<string, unknown> {
        return {
            grouping: this._grouping
        };
    }

    public with(overrides: {grouping?: Grouping}): RelationDetailInput_Decomposition {
        return new RelationDetailInput_Decomposition(
            'grouping' in overrides ? overrides.grouping! : this._grouping
        );
    }

    public static fromPlain(obj: {grouping: Grouping}): RelationDetailInput_Decomposition {
        return new RelationDetailInput_Decomposition(
            obj.grouping
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetailInput_Decomposition.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetailInput_Decomposition.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetailInput]#Decomposition'
    public baboonTypeIdentifier() {
        return RelationDetailInput_Decomposition.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RelationDetailInput_Decomposition.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RelationDetailInput_Decomposition.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RelationDetailInput_Decomposition.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetailInput'
    public baboonAdtTypeIdentifier() {
        return RelationDetailInput_Decomposition.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): RelationDetailInput_Decomposition_JsonCodec {
        return RelationDetailInput_Decomposition_JsonCodec.instance
    }
}

export class RelationDetailInput_Decomposition_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationDetailInput_Decomposition): unknown {
        if (this !== RelationDetailInput_Decomposition_JsonCodec.lazyInstance.value) {
          return RelationDetailInput_Decomposition_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "grouping": Grouping_JsonCodec.instance.encode(BaboonCodecContext.Default, value.grouping),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationDetailInput_Decomposition {
        if (this !== RelationDetailInput_Decomposition_JsonCodec .lazyInstance.value) {
            return RelationDetailInput_Decomposition_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RelationDetailInput_Decomposition (
            Grouping_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["grouping"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetailInput_Decomposition_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetailInput_Decomposition_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetailInput]#Decomposition'
    public baboonTypeIdentifier() {
        return RelationDetailInput_Decomposition_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetailInput'
    public baboonAdtTypeIdentifier() {
        return RelationDetailInput_Decomposition_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationDetailInput_Decomposition_JsonCodec())
    public static get instance(): RelationDetailInput_Decomposition_JsonCodec {
        return RelationDetailInput_Decomposition_JsonCodec.lazyInstance.value
    }
}

export class RelationDetailInput_Delegation implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#RelationDetailInput]#Delegation' as const;
    private readonly _actors: Array<string>;
    private readonly _operations: Array<string>;
    private readonly _outcomes: Array<Target>;

    constructor(actors: Array<string>, operations: Array<string>, outcomes: Array<Target>) {
        this._actors = actors
        this._operations = operations
        this._outcomes = outcomes
    }

    public get actors(): Array<string> {
        return this._actors;
    }
    public get operations(): Array<string> {
        return this._operations;
    }
    public get outcomes(): Array<Target> {
        return this._outcomes;
    }

    public toJSON(): Record<string, unknown> {
        return {
            actors: this._actors,
            operations: this._operations,
            outcomes: this._outcomes
        };
    }

    public with(overrides: {actors?: Array<string>; operations?: Array<string>; outcomes?: Array<Target>}): RelationDetailInput_Delegation {
        return new RelationDetailInput_Delegation(
            'actors' in overrides ? overrides.actors! : this._actors,
            'operations' in overrides ? overrides.operations! : this._operations,
            'outcomes' in overrides ? overrides.outcomes! : this._outcomes
        );
    }

    public static fromPlain(obj: {actors: Array<string>; operations: Array<string>; outcomes: Array<Target>}): RelationDetailInput_Delegation {
        return new RelationDetailInput_Delegation(
            obj.actors,
            obj.operations,
            obj.outcomes
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetailInput_Delegation.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetailInput_Delegation.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetailInput]#Delegation'
    public baboonTypeIdentifier() {
        return RelationDetailInput_Delegation.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RelationDetailInput_Delegation.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RelationDetailInput_Delegation.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RelationDetailInput_Delegation.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetailInput'
    public baboonAdtTypeIdentifier() {
        return RelationDetailInput_Delegation.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): RelationDetailInput_Delegation_JsonCodec {
        return RelationDetailInput_Delegation_JsonCodec.instance
    }
}

export class RelationDetailInput_Delegation_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationDetailInput_Delegation): unknown {
        if (this !== RelationDetailInput_Delegation_JsonCodec.lazyInstance.value) {
          return RelationDetailInput_Delegation_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "actors": Array.from(value.actors),
            "operations": Array.from(value.operations),
            "outcomes": Array.from(value.outcomes).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationDetailInput_Delegation {
        if (this !== RelationDetailInput_Delegation_JsonCodec .lazyInstance.value) {
            return RelationDetailInput_Delegation_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RelationDetailInput_Delegation (
            (obj["actors"] as unknown[]).map(item => item as string),
            (obj["operations"] as unknown[]).map(item => item as string),
            (obj["outcomes"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetailInput_Delegation_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetailInput_Delegation_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetailInput]#Delegation'
    public baboonTypeIdentifier() {
        return RelationDetailInput_Delegation_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetailInput'
    public baboonAdtTypeIdentifier() {
        return RelationDetailInput_Delegation_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationDetailInput_Delegation_JsonCodec())
    public static get instance(): RelationDetailInput_Delegation_JsonCodec {
        return RelationDetailInput_Delegation_JsonCodec.lazyInstance.value
    }
}

export class RelationDetailInput_Adoption implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#RelationDetailInput]#Adoption' as const;
    private readonly _presentationId: string;
    private readonly _origin: AdoptionOrigin;

    constructor(presentationId: string, origin: AdoptionOrigin) {
        this._presentationId = presentationId
        this._origin = origin
    }

    public get presentationId(): string {
        return this._presentationId;
    }
    public get origin(): AdoptionOrigin {
        return this._origin;
    }

    public toJSON(): Record<string, unknown> {
        return {
            presentationId: this._presentationId,
            origin: this._origin
        };
    }

    public with(overrides: {presentationId?: string; origin?: AdoptionOrigin}): RelationDetailInput_Adoption {
        return new RelationDetailInput_Adoption(
            'presentationId' in overrides ? overrides.presentationId! : this._presentationId,
            'origin' in overrides ? overrides.origin! : this._origin
        );
    }

    public static fromPlain(obj: {presentationId: string; origin: AdoptionOrigin}): RelationDetailInput_Adoption {
        return new RelationDetailInput_Adoption(
            obj.presentationId,
            obj.origin
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetailInput_Adoption.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetailInput_Adoption.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetailInput]#Adoption'
    public baboonTypeIdentifier() {
        return RelationDetailInput_Adoption.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RelationDetailInput_Adoption.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RelationDetailInput_Adoption.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RelationDetailInput_Adoption.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetailInput'
    public baboonAdtTypeIdentifier() {
        return RelationDetailInput_Adoption.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): RelationDetailInput_Adoption_JsonCodec {
        return RelationDetailInput_Adoption_JsonCodec.instance
    }
}

export class RelationDetailInput_Adoption_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationDetailInput_Adoption): unknown {
        if (this !== RelationDetailInput_Adoption_JsonCodec.lazyInstance.value) {
          return RelationDetailInput_Adoption_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "presentationId": value.presentationId,
            "origin": AdoptionOrigin_JsonCodec.instance.encode(BaboonCodecContext.Default, value.origin),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationDetailInput_Adoption {
        if (this !== RelationDetailInput_Adoption_JsonCodec .lazyInstance.value) {
            return RelationDetailInput_Adoption_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RelationDetailInput_Adoption (
            obj["presentationId"] as string,
            AdoptionOrigin_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["origin"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetailInput_Adoption_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetailInput_Adoption_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetailInput]#Adoption'
    public baboonTypeIdentifier() {
        return RelationDetailInput_Adoption_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetailInput'
    public baboonAdtTypeIdentifier() {
        return RelationDetailInput_Adoption_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationDetailInput_Adoption_JsonCodec())
    public static get instance(): RelationDetailInput_Adoption_JsonCodec {
        return RelationDetailInput_Adoption_JsonCodec.lazyInstance.value
    }
}

export class RelationDetailInput_AssessmentUse implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#RelationDetailInput]#AssessmentUse' as const;
    private readonly _requirement: Target;
    private readonly _disposition: AssessmentUseDisposition;
    private readonly _basis: Array<Target>;

    constructor(requirement: Target, disposition: AssessmentUseDisposition, basis: Array<Target>) {
        this._requirement = requirement
        this._disposition = disposition
        this._basis = basis
    }

    public get requirement(): Target {
        return this._requirement;
    }
    public get disposition(): AssessmentUseDisposition {
        return this._disposition;
    }
    public get basis(): Array<Target> {
        return this._basis;
    }

    public toJSON(): Record<string, unknown> {
        return {
            requirement: this._requirement,
            disposition: this._disposition,
            basis: this._basis
        };
    }

    public with(overrides: {requirement?: Target; disposition?: AssessmentUseDisposition; basis?: Array<Target>}): RelationDetailInput_AssessmentUse {
        return new RelationDetailInput_AssessmentUse(
            'requirement' in overrides ? overrides.requirement! : this._requirement,
            'disposition' in overrides ? overrides.disposition! : this._disposition,
            'basis' in overrides ? overrides.basis! : this._basis
        );
    }

    public static fromPlain(obj: {requirement: Target; disposition: AssessmentUseDisposition; basis: Array<Target>}): RelationDetailInput_AssessmentUse {
        return new RelationDetailInput_AssessmentUse(
            obj.requirement,
            obj.disposition,
            obj.basis
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetailInput_AssessmentUse.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetailInput_AssessmentUse.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetailInput]#AssessmentUse'
    public baboonTypeIdentifier() {
        return RelationDetailInput_AssessmentUse.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RelationDetailInput_AssessmentUse.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RelationDetailInput_AssessmentUse.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RelationDetailInput_AssessmentUse.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetailInput'
    public baboonAdtTypeIdentifier() {
        return RelationDetailInput_AssessmentUse.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): RelationDetailInput_AssessmentUse_JsonCodec {
        return RelationDetailInput_AssessmentUse_JsonCodec.instance
    }
}

export class RelationDetailInput_AssessmentUse_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationDetailInput_AssessmentUse): unknown {
        if (this !== RelationDetailInput_AssessmentUse_JsonCodec.lazyInstance.value) {
          return RelationDetailInput_AssessmentUse_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "requirement": Target_JsonCodec.instance.encode(BaboonCodecContext.Default, value.requirement),
            "disposition": AssessmentUseDisposition_JsonCodec.instance.encode(BaboonCodecContext.Default, value.disposition),
            "basis": Array.from(value.basis).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationDetailInput_AssessmentUse {
        if (this !== RelationDetailInput_AssessmentUse_JsonCodec .lazyInstance.value) {
            return RelationDetailInput_AssessmentUse_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RelationDetailInput_AssessmentUse (
            Target_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["requirement"]),
            AssessmentUseDisposition_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["disposition"]),
            (obj["basis"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetailInput_AssessmentUse_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetailInput_AssessmentUse_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetailInput]#AssessmentUse'
    public baboonTypeIdentifier() {
        return RelationDetailInput_AssessmentUse_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetailInput'
    public baboonAdtTypeIdentifier() {
        return RelationDetailInput_AssessmentUse_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationDetailInput_AssessmentUse_JsonCodec())
    public static get instance(): RelationDetailInput_AssessmentUse_JsonCodec {
        return RelationDetailInput_AssessmentUse_JsonCodec.lazyInstance.value
    }
}


export class RelationDetailInput_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationDetailInput): unknown {
        if (this !== RelationDetailInput_JsonCodec.lazyInstance.value) {
          return RelationDetailInput_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof RelationDetailInput_Empty) {
                return { "Empty": RelationDetailInput_Empty_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof RelationDetailInput_Dependency) {
                return { "Dependency": RelationDetailInput_Dependency_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof RelationDetailInput_Decomposition) {
                return { "Decomposition": RelationDetailInput_Decomposition_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof RelationDetailInput_Delegation) {
                return { "Delegation": RelationDetailInput_Delegation_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof RelationDetailInput_Adoption) {
                return { "Adoption": RelationDetailInput_Adoption_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof RelationDetailInput_AssessmentUse) {
                return { "AssessmentUse": RelationDetailInput_AssessmentUse_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationDetailInput {
        if (this !== RelationDetailInput_JsonCodec .lazyInstance.value) {
            return RelationDetailInput_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Empty": return RelationDetailInput_Empty_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Dependency": return RelationDetailInput_Dependency_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Decomposition": return RelationDetailInput_Decomposition_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Delegation": return RelationDetailInput_Delegation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Adoption": return RelationDetailInput_Adoption_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "AssessmentUse": return RelationDetailInput_AssessmentUse_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetailInput_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetailInput_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#RelationDetailInput'
    public baboonTypeIdentifier() {
        return RelationDetailInput_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetailInput'
    public baboonAdtTypeIdentifier() {
        return RelationDetailInput_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationDetailInput_JsonCodec())
    public static get instance(): RelationDetailInput_JsonCodec {
        return RelationDetailInput_JsonCodec.lazyInstance.value
    }
}