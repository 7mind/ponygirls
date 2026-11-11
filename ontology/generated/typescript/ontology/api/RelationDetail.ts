import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {AdoptionOrigin, AdoptionOrigin_JsonCodec} from './AdoptionOrigin.js'
import {AssessmentUseDisposition, AssessmentUseDisposition_JsonCodec} from './AssessmentUseDisposition.js'
import {Consumption, Consumption_JsonCodec} from './Consumption.js'
import {Gate, Gate_JsonCodec} from './Gate.js'
import {Grouping, Grouping_JsonCodec} from './Grouping.js'
import {PresentedSelection, PresentedSelection_JsonCodec} from './PresentedSelection.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export type RelationDetail = RelationDetail_Empty | RelationDetail_Dependency | RelationDetail_PlanRequirement | RelationDetail_Decomposition | RelationDetail_Delegation | RelationDetail_Adoption | RelationDetail_AssessmentUse

export const RelationDetail = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#RelationDetail',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#RelationDetail',
    jsonCodec(): RelationDetail_JsonCodec {
        return RelationDetail_JsonCodec.instance
    }
} as const

export class RelationDetail_Empty implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#RelationDetail]#Empty' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): RelationDetail_Empty {
        return new RelationDetail_Empty(
            
        );
    }

    public static fromPlain(obj: {}): RelationDetail_Empty {
        return new RelationDetail_Empty(
            
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetail_Empty.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetail_Empty.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetail]#Empty'
    public baboonTypeIdentifier() {
        return RelationDetail_Empty.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RelationDetail_Empty.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RelationDetail_Empty.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RelationDetail_Empty.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonAdtTypeIdentifier() {
        return RelationDetail_Empty.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): RelationDetail_Empty_JsonCodec {
        return RelationDetail_Empty_JsonCodec.instance
    }
}

export class RelationDetail_Empty_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationDetail_Empty): unknown {
        if (this !== RelationDetail_Empty_JsonCodec.lazyInstance.value) {
          return RelationDetail_Empty_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationDetail_Empty {
        if (this !== RelationDetail_Empty_JsonCodec .lazyInstance.value) {
            return RelationDetail_Empty_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RelationDetail_Empty (
            
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetail_Empty_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetail_Empty_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetail]#Empty'
    public baboonTypeIdentifier() {
        return RelationDetail_Empty_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonAdtTypeIdentifier() {
        return RelationDetail_Empty_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationDetail_Empty_JsonCodec())
    public static get instance(): RelationDetail_Empty_JsonCodec {
        return RelationDetail_Empty_JsonCodec.lazyInstance.value
    }
}

export class RelationDetail_Dependency implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#RelationDetail]#Dependency' as const;
    private readonly _gate: Gate;
    private readonly _consumption: Consumption;
    private readonly _event: Ref | undefined;
    private readonly _applicability: string;

    constructor(gate: Gate, consumption: Consumption, event: Ref | undefined, applicability: string) {
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
    public get event(): Ref | undefined {
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

    public with(overrides: {gate?: Gate; consumption?: Consumption; event?: Ref | undefined; applicability?: string}): RelationDetail_Dependency {
        return new RelationDetail_Dependency(
            'gate' in overrides ? overrides.gate! : this._gate,
            'consumption' in overrides ? overrides.consumption! : this._consumption,
            'event' in overrides ? overrides.event! : this._event,
            'applicability' in overrides ? overrides.applicability! : this._applicability
        );
    }

    public static fromPlain(obj: {gate: Gate; consumption: Consumption; event: Ref | undefined; applicability: string}): RelationDetail_Dependency {
        return new RelationDetail_Dependency(
            obj.gate,
            obj.consumption,
            obj.event,
            obj.applicability
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetail_Dependency.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetail_Dependency.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetail]#Dependency'
    public baboonTypeIdentifier() {
        return RelationDetail_Dependency.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RelationDetail_Dependency.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RelationDetail_Dependency.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RelationDetail_Dependency.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonAdtTypeIdentifier() {
        return RelationDetail_Dependency.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): RelationDetail_Dependency_JsonCodec {
        return RelationDetail_Dependency_JsonCodec.instance
    }
}

export class RelationDetail_Dependency_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationDetail_Dependency): unknown {
        if (this !== RelationDetail_Dependency_JsonCodec.lazyInstance.value) {
          return RelationDetail_Dependency_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "gate": Gate_JsonCodec.instance.encode(BaboonCodecContext.Default, value.gate),
            "consumption": Consumption_JsonCodec.instance.encode(BaboonCodecContext.Default, value.consumption),
            "event": value.event === undefined ? null : Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.event),
            "applicability": value.applicability,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationDetail_Dependency {
        if (this !== RelationDetail_Dependency_JsonCodec .lazyInstance.value) {
            return RelationDetail_Dependency_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RelationDetail_Dependency (
            Gate_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["gate"]),
            Consumption_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["consumption"]),
            obj["event"] === undefined || obj["event"] === null ? undefined : obj["event"] === undefined || obj["event"] === null ? undefined : Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["event"]),
            obj["applicability"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetail_Dependency_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetail_Dependency_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetail]#Dependency'
    public baboonTypeIdentifier() {
        return RelationDetail_Dependency_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonAdtTypeIdentifier() {
        return RelationDetail_Dependency_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationDetail_Dependency_JsonCodec())
    public static get instance(): RelationDetail_Dependency_JsonCodec {
        return RelationDetail_Dependency_JsonCodec.lazyInstance.value
    }
}

export class RelationDetail_PlanRequirement implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#RelationDetail]#PlanRequirement' as const;
    private readonly _workContext: string;

    constructor(workContext: string) {
        this._workContext = workContext
    }

    public get workContext(): string {
        return this._workContext;
    }

    public toJSON(): Record<string, unknown> {
        return {
            workContext: this._workContext
        };
    }

    public with(overrides: {workContext?: string}): RelationDetail_PlanRequirement {
        return new RelationDetail_PlanRequirement(
            'workContext' in overrides ? overrides.workContext! : this._workContext
        );
    }

    public static fromPlain(obj: {workContext: string}): RelationDetail_PlanRequirement {
        return new RelationDetail_PlanRequirement(
            obj.workContext
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetail_PlanRequirement.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetail_PlanRequirement.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetail]#PlanRequirement'
    public baboonTypeIdentifier() {
        return RelationDetail_PlanRequirement.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RelationDetail_PlanRequirement.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RelationDetail_PlanRequirement.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RelationDetail_PlanRequirement.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonAdtTypeIdentifier() {
        return RelationDetail_PlanRequirement.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): RelationDetail_PlanRequirement_JsonCodec {
        return RelationDetail_PlanRequirement_JsonCodec.instance
    }
}

export class RelationDetail_PlanRequirement_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationDetail_PlanRequirement): unknown {
        if (this !== RelationDetail_PlanRequirement_JsonCodec.lazyInstance.value) {
          return RelationDetail_PlanRequirement_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "workContext": value.workContext,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationDetail_PlanRequirement {
        if (this !== RelationDetail_PlanRequirement_JsonCodec .lazyInstance.value) {
            return RelationDetail_PlanRequirement_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RelationDetail_PlanRequirement (
            obj["workContext"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetail_PlanRequirement_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetail_PlanRequirement_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetail]#PlanRequirement'
    public baboonTypeIdentifier() {
        return RelationDetail_PlanRequirement_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonAdtTypeIdentifier() {
        return RelationDetail_PlanRequirement_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationDetail_PlanRequirement_JsonCodec())
    public static get instance(): RelationDetail_PlanRequirement_JsonCodec {
        return RelationDetail_PlanRequirement_JsonCodec.lazyInstance.value
    }
}

export class RelationDetail_Decomposition implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#RelationDetail]#Decomposition' as const;
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

    public with(overrides: {grouping?: Grouping}): RelationDetail_Decomposition {
        return new RelationDetail_Decomposition(
            'grouping' in overrides ? overrides.grouping! : this._grouping
        );
    }

    public static fromPlain(obj: {grouping: Grouping}): RelationDetail_Decomposition {
        return new RelationDetail_Decomposition(
            obj.grouping
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetail_Decomposition.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetail_Decomposition.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetail]#Decomposition'
    public baboonTypeIdentifier() {
        return RelationDetail_Decomposition.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RelationDetail_Decomposition.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RelationDetail_Decomposition.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RelationDetail_Decomposition.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonAdtTypeIdentifier() {
        return RelationDetail_Decomposition.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): RelationDetail_Decomposition_JsonCodec {
        return RelationDetail_Decomposition_JsonCodec.instance
    }
}

export class RelationDetail_Decomposition_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationDetail_Decomposition): unknown {
        if (this !== RelationDetail_Decomposition_JsonCodec.lazyInstance.value) {
          return RelationDetail_Decomposition_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "grouping": Grouping_JsonCodec.instance.encode(BaboonCodecContext.Default, value.grouping),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationDetail_Decomposition {
        if (this !== RelationDetail_Decomposition_JsonCodec .lazyInstance.value) {
            return RelationDetail_Decomposition_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RelationDetail_Decomposition (
            Grouping_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["grouping"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetail_Decomposition_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetail_Decomposition_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetail]#Decomposition'
    public baboonTypeIdentifier() {
        return RelationDetail_Decomposition_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonAdtTypeIdentifier() {
        return RelationDetail_Decomposition_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationDetail_Decomposition_JsonCodec())
    public static get instance(): RelationDetail_Decomposition_JsonCodec {
        return RelationDetail_Decomposition_JsonCodec.lazyInstance.value
    }
}

export class RelationDetail_Delegation implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#RelationDetail]#Delegation' as const;
    private readonly _actors: Array<string>;
    private readonly _operations: Array<string>;
    private readonly _outcomes: Array<Ref>;

    constructor(actors: Array<string>, operations: Array<string>, outcomes: Array<Ref>) {
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
    public get outcomes(): Array<Ref> {
        return this._outcomes;
    }

    public toJSON(): Record<string, unknown> {
        return {
            actors: this._actors,
            operations: this._operations,
            outcomes: this._outcomes
        };
    }

    public with(overrides: {actors?: Array<string>; operations?: Array<string>; outcomes?: Array<Ref>}): RelationDetail_Delegation {
        return new RelationDetail_Delegation(
            'actors' in overrides ? overrides.actors! : this._actors,
            'operations' in overrides ? overrides.operations! : this._operations,
            'outcomes' in overrides ? overrides.outcomes! : this._outcomes
        );
    }

    public static fromPlain(obj: {actors: Array<string>; operations: Array<string>; outcomes: Array<Ref>}): RelationDetail_Delegation {
        return new RelationDetail_Delegation(
            obj.actors,
            obj.operations,
            obj.outcomes
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetail_Delegation.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetail_Delegation.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetail]#Delegation'
    public baboonTypeIdentifier() {
        return RelationDetail_Delegation.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RelationDetail_Delegation.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RelationDetail_Delegation.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RelationDetail_Delegation.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonAdtTypeIdentifier() {
        return RelationDetail_Delegation.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): RelationDetail_Delegation_JsonCodec {
        return RelationDetail_Delegation_JsonCodec.instance
    }
}

export class RelationDetail_Delegation_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationDetail_Delegation): unknown {
        if (this !== RelationDetail_Delegation_JsonCodec.lazyInstance.value) {
          return RelationDetail_Delegation_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "actors": Array.from(value.actors),
            "operations": Array.from(value.operations),
            "outcomes": Array.from(value.outcomes).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationDetail_Delegation {
        if (this !== RelationDetail_Delegation_JsonCodec .lazyInstance.value) {
            return RelationDetail_Delegation_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RelationDetail_Delegation (
            (obj["actors"] as unknown[]).map(item => item as string),
            (obj["operations"] as unknown[]).map(item => item as string),
            (obj["outcomes"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetail_Delegation_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetail_Delegation_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetail]#Delegation'
    public baboonTypeIdentifier() {
        return RelationDetail_Delegation_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonAdtTypeIdentifier() {
        return RelationDetail_Delegation_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationDetail_Delegation_JsonCodec())
    public static get instance(): RelationDetail_Delegation_JsonCodec {
        return RelationDetail_Delegation_JsonCodec.lazyInstance.value
    }
}

export class RelationDetail_Adoption implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#RelationDetail]#Adoption' as const;
    private readonly _presentationId: string;
    private readonly _origin: AdoptionOrigin;
    private readonly _response: Ref;
    private readonly _selection: PresentedSelection;

    constructor(presentationId: string, origin: AdoptionOrigin, response: Ref, selection: PresentedSelection) {
        this._presentationId = presentationId
        this._origin = origin
        this._response = response
        this._selection = selection
    }

    public get presentationId(): string {
        return this._presentationId;
    }
    public get origin(): AdoptionOrigin {
        return this._origin;
    }
    public get response(): Ref {
        return this._response;
    }
    public get selection(): PresentedSelection {
        return this._selection;
    }

    public toJSON(): Record<string, unknown> {
        return {
            presentationId: this._presentationId,
            origin: this._origin,
            response: this._response,
            selection: this._selection
        };
    }

    public with(overrides: {presentationId?: string; origin?: AdoptionOrigin; response?: Ref; selection?: PresentedSelection}): RelationDetail_Adoption {
        return new RelationDetail_Adoption(
            'presentationId' in overrides ? overrides.presentationId! : this._presentationId,
            'origin' in overrides ? overrides.origin! : this._origin,
            'response' in overrides ? overrides.response! : this._response,
            'selection' in overrides ? overrides.selection! : this._selection
        );
    }

    public static fromPlain(obj: {presentationId: string; origin: AdoptionOrigin; response: Ref; selection: PresentedSelection}): RelationDetail_Adoption {
        return new RelationDetail_Adoption(
            obj.presentationId,
            obj.origin,
            obj.response,
            obj.selection
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetail_Adoption.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetail_Adoption.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetail]#Adoption'
    public baboonTypeIdentifier() {
        return RelationDetail_Adoption.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RelationDetail_Adoption.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RelationDetail_Adoption.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RelationDetail_Adoption.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonAdtTypeIdentifier() {
        return RelationDetail_Adoption.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): RelationDetail_Adoption_JsonCodec {
        return RelationDetail_Adoption_JsonCodec.instance
    }
}

export class RelationDetail_Adoption_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationDetail_Adoption): unknown {
        if (this !== RelationDetail_Adoption_JsonCodec.lazyInstance.value) {
          return RelationDetail_Adoption_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "presentationId": value.presentationId,
            "origin": AdoptionOrigin_JsonCodec.instance.encode(BaboonCodecContext.Default, value.origin),
            "response": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.response),
            "selection": PresentedSelection_JsonCodec.instance.encode(BaboonCodecContext.Default, value.selection),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationDetail_Adoption {
        if (this !== RelationDetail_Adoption_JsonCodec .lazyInstance.value) {
            return RelationDetail_Adoption_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RelationDetail_Adoption (
            obj["presentationId"] as string,
            AdoptionOrigin_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["origin"]),
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["response"]),
            PresentedSelection_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["selection"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetail_Adoption_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetail_Adoption_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetail]#Adoption'
    public baboonTypeIdentifier() {
        return RelationDetail_Adoption_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonAdtTypeIdentifier() {
        return RelationDetail_Adoption_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationDetail_Adoption_JsonCodec())
    public static get instance(): RelationDetail_Adoption_JsonCodec {
        return RelationDetail_Adoption_JsonCodec.lazyInstance.value
    }
}

export class RelationDetail_AssessmentUse implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#RelationDetail]#AssessmentUse' as const;
    private readonly _requirement: Ref;
    private readonly _disposition: AssessmentUseDisposition;
    private readonly _basis: Array<Ref>;

    constructor(requirement: Ref, disposition: AssessmentUseDisposition, basis: Array<Ref>) {
        this._requirement = requirement
        this._disposition = disposition
        this._basis = basis
    }

    public get requirement(): Ref {
        return this._requirement;
    }
    public get disposition(): AssessmentUseDisposition {
        return this._disposition;
    }
    public get basis(): Array<Ref> {
        return this._basis;
    }

    public toJSON(): Record<string, unknown> {
        return {
            requirement: this._requirement,
            disposition: this._disposition,
            basis: this._basis
        };
    }

    public with(overrides: {requirement?: Ref; disposition?: AssessmentUseDisposition; basis?: Array<Ref>}): RelationDetail_AssessmentUse {
        return new RelationDetail_AssessmentUse(
            'requirement' in overrides ? overrides.requirement! : this._requirement,
            'disposition' in overrides ? overrides.disposition! : this._disposition,
            'basis' in overrides ? overrides.basis! : this._basis
        );
    }

    public static fromPlain(obj: {requirement: Ref; disposition: AssessmentUseDisposition; basis: Array<Ref>}): RelationDetail_AssessmentUse {
        return new RelationDetail_AssessmentUse(
            obj.requirement,
            obj.disposition,
            obj.basis
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetail_AssessmentUse.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetail_AssessmentUse.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetail]#AssessmentUse'
    public baboonTypeIdentifier() {
        return RelationDetail_AssessmentUse.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RelationDetail_AssessmentUse.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RelationDetail_AssessmentUse.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RelationDetail_AssessmentUse.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonAdtTypeIdentifier() {
        return RelationDetail_AssessmentUse.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): RelationDetail_AssessmentUse_JsonCodec {
        return RelationDetail_AssessmentUse_JsonCodec.instance
    }
}

export class RelationDetail_AssessmentUse_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationDetail_AssessmentUse): unknown {
        if (this !== RelationDetail_AssessmentUse_JsonCodec.lazyInstance.value) {
          return RelationDetail_AssessmentUse_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "requirement": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.requirement),
            "disposition": AssessmentUseDisposition_JsonCodec.instance.encode(BaboonCodecContext.Default, value.disposition),
            "basis": Array.from(value.basis).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationDetail_AssessmentUse {
        if (this !== RelationDetail_AssessmentUse_JsonCodec .lazyInstance.value) {
            return RelationDetail_AssessmentUse_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RelationDetail_AssessmentUse (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["requirement"]),
            AssessmentUseDisposition_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["disposition"]),
            (obj["basis"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetail_AssessmentUse_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetail_AssessmentUse_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#RelationDetail]#AssessmentUse'
    public baboonTypeIdentifier() {
        return RelationDetail_AssessmentUse_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonAdtTypeIdentifier() {
        return RelationDetail_AssessmentUse_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationDetail_AssessmentUse_JsonCodec())
    public static get instance(): RelationDetail_AssessmentUse_JsonCodec {
        return RelationDetail_AssessmentUse_JsonCodec.lazyInstance.value
    }
}


export class RelationDetail_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationDetail): unknown {
        if (this !== RelationDetail_JsonCodec.lazyInstance.value) {
          return RelationDetail_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof RelationDetail_Empty) {
                return { "Empty": RelationDetail_Empty_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof RelationDetail_Dependency) {
                return { "Dependency": RelationDetail_Dependency_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof RelationDetail_PlanRequirement) {
                return { "PlanRequirement": RelationDetail_PlanRequirement_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof RelationDetail_Decomposition) {
                return { "Decomposition": RelationDetail_Decomposition_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof RelationDetail_Delegation) {
                return { "Delegation": RelationDetail_Delegation_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof RelationDetail_Adoption) {
                return { "Adoption": RelationDetail_Adoption_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof RelationDetail_AssessmentUse) {
                return { "AssessmentUse": RelationDetail_AssessmentUse_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationDetail {
        if (this !== RelationDetail_JsonCodec .lazyInstance.value) {
            return RelationDetail_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Empty": return RelationDetail_Empty_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Dependency": return RelationDetail_Dependency_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "PlanRequirement": return RelationDetail_PlanRequirement_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Decomposition": return RelationDetail_Decomposition_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Delegation": return RelationDetail_Delegation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Adoption": return RelationDetail_Adoption_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "AssessmentUse": return RelationDetail_AssessmentUse_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationDetail_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationDetail_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonTypeIdentifier() {
        return RelationDetail_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#RelationDetail'
    public baboonAdtTypeIdentifier() {
        return RelationDetail_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationDetail_JsonCodec())
    public static get instance(): RelationDetail_JsonCodec {
        return RelationDetail_JsonCodec.lazyInstance.value
    }
}