import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ActorRecord, ActorRecord_JsonCodec} from './ActorRecord.js'
import {Binding, Binding_JsonCodec} from './Binding.js'
import {BindingSelection, BindingSelection_JsonCodec} from './BindingSelection.js'
import {Definition, Definition_JsonCodec} from './Definition.js'
import {InputReceipt, InputReceipt_JsonCodec} from './InputReceipt.js'
import {Relation, Relation_JsonCodec} from './Relation.js'
import {StateEvent, StateEvent_JsonCodec} from './StateEvent.js'

export type GraphRecord = GraphRecord_Input | GraphRecord_Person | GraphRecord_Node | GraphRecord_Edge | GraphRecord_Contract | GraphRecord_Progress | GraphRecord_Selection

export const GraphRecord = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#GraphRecord',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#GraphRecord',
    jsonCodec(): GraphRecord_JsonCodec {
        return GraphRecord_JsonCodec.instance
    }
} as const

export class GraphRecord_Input implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#GraphRecord]#Input' as const;
    private readonly _value: InputReceipt;

    constructor(value: InputReceipt) {
        this._value = value
    }

    public get value(): InputReceipt {
        return this._value;
    }

    public toJSON(): Record<string, unknown> {
        return {
            value: this._value
        };
    }

    public with(overrides: {value?: InputReceipt}): GraphRecord_Input {
        return new GraphRecord_Input(
            'value' in overrides ? overrides.value! : this._value
        );
    }

    public static fromPlain(obj: {value: InputReceipt}): GraphRecord_Input {
        return new GraphRecord_Input(
            obj.value
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphRecord_Input.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphRecord_Input.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#GraphRecord]#Input'
    public baboonTypeIdentifier() {
        return GraphRecord_Input.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return GraphRecord_Input.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return GraphRecord_Input.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return GraphRecord_Input.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonAdtTypeIdentifier() {
        return GraphRecord_Input.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): GraphRecord_Input_JsonCodec {
        return GraphRecord_Input_JsonCodec.instance
    }
}

export class GraphRecord_Input_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GraphRecord_Input): unknown {
        if (this !== GraphRecord_Input_JsonCodec.lazyInstance.value) {
          return GraphRecord_Input_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "value": InputReceipt_JsonCodec.instance.encode(BaboonCodecContext.Default, value.value),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GraphRecord_Input {
        if (this !== GraphRecord_Input_JsonCodec .lazyInstance.value) {
            return GraphRecord_Input_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new GraphRecord_Input (
            InputReceipt_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["value"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphRecord_Input_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphRecord_Input_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#GraphRecord]#Input'
    public baboonTypeIdentifier() {
        return GraphRecord_Input_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonAdtTypeIdentifier() {
        return GraphRecord_Input_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GraphRecord_Input_JsonCodec())
    public static get instance(): GraphRecord_Input_JsonCodec {
        return GraphRecord_Input_JsonCodec.lazyInstance.value
    }
}

export class GraphRecord_Person implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#GraphRecord]#Person' as const;
    private readonly _value: ActorRecord;

    constructor(value: ActorRecord) {
        this._value = value
    }

    public get value(): ActorRecord {
        return this._value;
    }

    public toJSON(): Record<string, unknown> {
        return {
            value: this._value
        };
    }

    public with(overrides: {value?: ActorRecord}): GraphRecord_Person {
        return new GraphRecord_Person(
            'value' in overrides ? overrides.value! : this._value
        );
    }

    public static fromPlain(obj: {value: ActorRecord}): GraphRecord_Person {
        return new GraphRecord_Person(
            obj.value
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphRecord_Person.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphRecord_Person.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#GraphRecord]#Person'
    public baboonTypeIdentifier() {
        return GraphRecord_Person.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return GraphRecord_Person.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return GraphRecord_Person.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return GraphRecord_Person.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonAdtTypeIdentifier() {
        return GraphRecord_Person.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): GraphRecord_Person_JsonCodec {
        return GraphRecord_Person_JsonCodec.instance
    }
}

export class GraphRecord_Person_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GraphRecord_Person): unknown {
        if (this !== GraphRecord_Person_JsonCodec.lazyInstance.value) {
          return GraphRecord_Person_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "value": ActorRecord_JsonCodec.instance.encode(BaboonCodecContext.Default, value.value),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GraphRecord_Person {
        if (this !== GraphRecord_Person_JsonCodec .lazyInstance.value) {
            return GraphRecord_Person_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new GraphRecord_Person (
            ActorRecord_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["value"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphRecord_Person_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphRecord_Person_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#GraphRecord]#Person'
    public baboonTypeIdentifier() {
        return GraphRecord_Person_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonAdtTypeIdentifier() {
        return GraphRecord_Person_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GraphRecord_Person_JsonCodec())
    public static get instance(): GraphRecord_Person_JsonCodec {
        return GraphRecord_Person_JsonCodec.lazyInstance.value
    }
}

export class GraphRecord_Node implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#GraphRecord]#Node' as const;
    private readonly _value: Definition;

    constructor(value: Definition) {
        this._value = value
    }

    public get value(): Definition {
        return this._value;
    }

    public toJSON(): Record<string, unknown> {
        return {
            value: this._value
        };
    }

    public with(overrides: {value?: Definition}): GraphRecord_Node {
        return new GraphRecord_Node(
            'value' in overrides ? overrides.value! : this._value
        );
    }

    public static fromPlain(obj: {value: Definition}): GraphRecord_Node {
        return new GraphRecord_Node(
            obj.value
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphRecord_Node.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphRecord_Node.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#GraphRecord]#Node'
    public baboonTypeIdentifier() {
        return GraphRecord_Node.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return GraphRecord_Node.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return GraphRecord_Node.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return GraphRecord_Node.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonAdtTypeIdentifier() {
        return GraphRecord_Node.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): GraphRecord_Node_JsonCodec {
        return GraphRecord_Node_JsonCodec.instance
    }
}

export class GraphRecord_Node_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GraphRecord_Node): unknown {
        if (this !== GraphRecord_Node_JsonCodec.lazyInstance.value) {
          return GraphRecord_Node_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "value": Definition_JsonCodec.instance.encode(BaboonCodecContext.Default, value.value),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GraphRecord_Node {
        if (this !== GraphRecord_Node_JsonCodec .lazyInstance.value) {
            return GraphRecord_Node_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new GraphRecord_Node (
            Definition_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["value"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphRecord_Node_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphRecord_Node_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#GraphRecord]#Node'
    public baboonTypeIdentifier() {
        return GraphRecord_Node_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonAdtTypeIdentifier() {
        return GraphRecord_Node_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GraphRecord_Node_JsonCodec())
    public static get instance(): GraphRecord_Node_JsonCodec {
        return GraphRecord_Node_JsonCodec.lazyInstance.value
    }
}

export class GraphRecord_Edge implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#GraphRecord]#Edge' as const;
    private readonly _value: Relation;

    constructor(value: Relation) {
        this._value = value
    }

    public get value(): Relation {
        return this._value;
    }

    public toJSON(): Record<string, unknown> {
        return {
            value: this._value
        };
    }

    public with(overrides: {value?: Relation}): GraphRecord_Edge {
        return new GraphRecord_Edge(
            'value' in overrides ? overrides.value! : this._value
        );
    }

    public static fromPlain(obj: {value: Relation}): GraphRecord_Edge {
        return new GraphRecord_Edge(
            obj.value
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphRecord_Edge.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphRecord_Edge.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#GraphRecord]#Edge'
    public baboonTypeIdentifier() {
        return GraphRecord_Edge.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return GraphRecord_Edge.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return GraphRecord_Edge.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return GraphRecord_Edge.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonAdtTypeIdentifier() {
        return GraphRecord_Edge.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): GraphRecord_Edge_JsonCodec {
        return GraphRecord_Edge_JsonCodec.instance
    }
}

export class GraphRecord_Edge_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GraphRecord_Edge): unknown {
        if (this !== GraphRecord_Edge_JsonCodec.lazyInstance.value) {
          return GraphRecord_Edge_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "value": Relation_JsonCodec.instance.encode(BaboonCodecContext.Default, value.value),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GraphRecord_Edge {
        if (this !== GraphRecord_Edge_JsonCodec .lazyInstance.value) {
            return GraphRecord_Edge_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new GraphRecord_Edge (
            Relation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["value"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphRecord_Edge_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphRecord_Edge_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#GraphRecord]#Edge'
    public baboonTypeIdentifier() {
        return GraphRecord_Edge_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonAdtTypeIdentifier() {
        return GraphRecord_Edge_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GraphRecord_Edge_JsonCodec())
    public static get instance(): GraphRecord_Edge_JsonCodec {
        return GraphRecord_Edge_JsonCodec.lazyInstance.value
    }
}

export class GraphRecord_Contract implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#GraphRecord]#Contract' as const;
    private readonly _value: Binding;

    constructor(value: Binding) {
        this._value = value
    }

    public get value(): Binding {
        return this._value;
    }

    public toJSON(): Record<string, unknown> {
        return {
            value: this._value
        };
    }

    public with(overrides: {value?: Binding}): GraphRecord_Contract {
        return new GraphRecord_Contract(
            'value' in overrides ? overrides.value! : this._value
        );
    }

    public static fromPlain(obj: {value: Binding}): GraphRecord_Contract {
        return new GraphRecord_Contract(
            obj.value
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphRecord_Contract.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphRecord_Contract.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#GraphRecord]#Contract'
    public baboonTypeIdentifier() {
        return GraphRecord_Contract.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return GraphRecord_Contract.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return GraphRecord_Contract.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return GraphRecord_Contract.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonAdtTypeIdentifier() {
        return GraphRecord_Contract.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): GraphRecord_Contract_JsonCodec {
        return GraphRecord_Contract_JsonCodec.instance
    }
}

export class GraphRecord_Contract_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GraphRecord_Contract): unknown {
        if (this !== GraphRecord_Contract_JsonCodec.lazyInstance.value) {
          return GraphRecord_Contract_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "value": Binding_JsonCodec.instance.encode(BaboonCodecContext.Default, value.value),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GraphRecord_Contract {
        if (this !== GraphRecord_Contract_JsonCodec .lazyInstance.value) {
            return GraphRecord_Contract_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new GraphRecord_Contract (
            Binding_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["value"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphRecord_Contract_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphRecord_Contract_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#GraphRecord]#Contract'
    public baboonTypeIdentifier() {
        return GraphRecord_Contract_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonAdtTypeIdentifier() {
        return GraphRecord_Contract_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GraphRecord_Contract_JsonCodec())
    public static get instance(): GraphRecord_Contract_JsonCodec {
        return GraphRecord_Contract_JsonCodec.lazyInstance.value
    }
}

export class GraphRecord_Progress implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#GraphRecord]#Progress' as const;
    private readonly _value: StateEvent;

    constructor(value: StateEvent) {
        this._value = value
    }

    public get value(): StateEvent {
        return this._value;
    }

    public toJSON(): Record<string, unknown> {
        return {
            value: this._value
        };
    }

    public with(overrides: {value?: StateEvent}): GraphRecord_Progress {
        return new GraphRecord_Progress(
            'value' in overrides ? overrides.value! : this._value
        );
    }

    public static fromPlain(obj: {value: StateEvent}): GraphRecord_Progress {
        return new GraphRecord_Progress(
            obj.value
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphRecord_Progress.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphRecord_Progress.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#GraphRecord]#Progress'
    public baboonTypeIdentifier() {
        return GraphRecord_Progress.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return GraphRecord_Progress.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return GraphRecord_Progress.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return GraphRecord_Progress.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonAdtTypeIdentifier() {
        return GraphRecord_Progress.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): GraphRecord_Progress_JsonCodec {
        return GraphRecord_Progress_JsonCodec.instance
    }
}

export class GraphRecord_Progress_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GraphRecord_Progress): unknown {
        if (this !== GraphRecord_Progress_JsonCodec.lazyInstance.value) {
          return GraphRecord_Progress_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "value": StateEvent_JsonCodec.instance.encode(BaboonCodecContext.Default, value.value),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GraphRecord_Progress {
        if (this !== GraphRecord_Progress_JsonCodec .lazyInstance.value) {
            return GraphRecord_Progress_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new GraphRecord_Progress (
            StateEvent_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["value"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphRecord_Progress_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphRecord_Progress_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#GraphRecord]#Progress'
    public baboonTypeIdentifier() {
        return GraphRecord_Progress_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonAdtTypeIdentifier() {
        return GraphRecord_Progress_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GraphRecord_Progress_JsonCodec())
    public static get instance(): GraphRecord_Progress_JsonCodec {
        return GraphRecord_Progress_JsonCodec.lazyInstance.value
    }
}

export class GraphRecord_Selection implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#GraphRecord]#Selection' as const;
    private readonly _value: BindingSelection;

    constructor(value: BindingSelection) {
        this._value = value
    }

    public get value(): BindingSelection {
        return this._value;
    }

    public toJSON(): Record<string, unknown> {
        return {
            value: this._value
        };
    }

    public with(overrides: {value?: BindingSelection}): GraphRecord_Selection {
        return new GraphRecord_Selection(
            'value' in overrides ? overrides.value! : this._value
        );
    }

    public static fromPlain(obj: {value: BindingSelection}): GraphRecord_Selection {
        return new GraphRecord_Selection(
            obj.value
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphRecord_Selection.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphRecord_Selection.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#GraphRecord]#Selection'
    public baboonTypeIdentifier() {
        return GraphRecord_Selection.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return GraphRecord_Selection.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return GraphRecord_Selection.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return GraphRecord_Selection.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonAdtTypeIdentifier() {
        return GraphRecord_Selection.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): GraphRecord_Selection_JsonCodec {
        return GraphRecord_Selection_JsonCodec.instance
    }
}

export class GraphRecord_Selection_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GraphRecord_Selection): unknown {
        if (this !== GraphRecord_Selection_JsonCodec.lazyInstance.value) {
          return GraphRecord_Selection_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "value": BindingSelection_JsonCodec.instance.encode(BaboonCodecContext.Default, value.value),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GraphRecord_Selection {
        if (this !== GraphRecord_Selection_JsonCodec .lazyInstance.value) {
            return GraphRecord_Selection_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new GraphRecord_Selection (
            BindingSelection_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["value"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphRecord_Selection_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphRecord_Selection_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#GraphRecord]#Selection'
    public baboonTypeIdentifier() {
        return GraphRecord_Selection_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonAdtTypeIdentifier() {
        return GraphRecord_Selection_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GraphRecord_Selection_JsonCodec())
    public static get instance(): GraphRecord_Selection_JsonCodec {
        return GraphRecord_Selection_JsonCodec.lazyInstance.value
    }
}


export class GraphRecord_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GraphRecord): unknown {
        if (this !== GraphRecord_JsonCodec.lazyInstance.value) {
          return GraphRecord_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof GraphRecord_Input) {
                return { "Input": GraphRecord_Input_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof GraphRecord_Person) {
                return { "Person": GraphRecord_Person_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof GraphRecord_Node) {
                return { "Node": GraphRecord_Node_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof GraphRecord_Edge) {
                return { "Edge": GraphRecord_Edge_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof GraphRecord_Contract) {
                return { "Contract": GraphRecord_Contract_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof GraphRecord_Progress) {
                return { "Progress": GraphRecord_Progress_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof GraphRecord_Selection) {
                return { "Selection": GraphRecord_Selection_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GraphRecord {
        if (this !== GraphRecord_JsonCodec .lazyInstance.value) {
            return GraphRecord_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Input": return GraphRecord_Input_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Person": return GraphRecord_Person_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Node": return GraphRecord_Node_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Edge": return GraphRecord_Edge_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Contract": return GraphRecord_Contract_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Progress": return GraphRecord_Progress_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Selection": return GraphRecord_Selection_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphRecord_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphRecord_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonTypeIdentifier() {
        return GraphRecord_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#GraphRecord'
    public baboonAdtTypeIdentifier() {
        return GraphRecord_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GraphRecord_JsonCodec())
    public static get instance(): GraphRecord_JsonCodec {
        return GraphRecord_JsonCodec.lazyInstance.value
    }
}