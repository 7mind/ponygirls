import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {ActorRecord, ActorRecord_JsonCodec} from './ActorRecord.js'
import {Binding, Binding_JsonCodec} from './Binding.js'
import {BindingSelection, BindingSelection_JsonCodec} from './BindingSelection.js'
import {Definition, Definition_JsonCodec} from './Definition.js'
import {Relation, Relation_JsonCodec} from './Relation.js'
import {StateEvent, StateEvent_JsonCodec} from './StateEvent.js'

export class GraphSnapshot implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _generation: bigint;
    private readonly _coveredFrontier: bigint;
    private readonly _definitions: Array<Definition>;
    private readonly _relations: Array<Relation>;
    private readonly _bindings: Array<Binding>;
    private readonly _events: Array<StateEvent>;
    private readonly _actors: Array<ActorRecord>;
    private readonly _selections: Array<BindingSelection>;

    constructor(scope: string, generation: bigint, coveredFrontier: bigint, definitions: Array<Definition>, relations: Array<Relation>, bindings: Array<Binding>, events: Array<StateEvent>, actors: Array<ActorRecord>, selections: Array<BindingSelection>) {
        this._scope = scope
        this._generation = generation
        this._coveredFrontier = coveredFrontier
        this._definitions = definitions
        this._relations = relations
        this._bindings = bindings
        this._events = events
        this._actors = actors
        this._selections = selections
    }

    public get scope(): string {
        return this._scope;
    }
    public get generation(): bigint {
        return this._generation;
    }
    public get coveredFrontier(): bigint {
        return this._coveredFrontier;
    }
    public get definitions(): Array<Definition> {
        return this._definitions;
    }
    public get relations(): Array<Relation> {
        return this._relations;
    }
    public get bindings(): Array<Binding> {
        return this._bindings;
    }
    public get events(): Array<StateEvent> {
        return this._events;
    }
    public get actors(): Array<ActorRecord> {
        return this._actors;
    }
    public get selections(): Array<BindingSelection> {
        return this._selections;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            generation: this._generation,
            coveredFrontier: this._coveredFrontier,
            definitions: this._definitions,
            relations: this._relations,
            bindings: this._bindings,
            events: this._events,
            actors: this._actors,
            selections: this._selections
        };
    }

    public with(overrides: {scope?: string; generation?: bigint; coveredFrontier?: bigint; definitions?: Array<Definition>; relations?: Array<Relation>; bindings?: Array<Binding>; events?: Array<StateEvent>; actors?: Array<ActorRecord>; selections?: Array<BindingSelection>}): GraphSnapshot {
        return new GraphSnapshot(
            'scope' in overrides ? overrides.scope! : this._scope,
            'generation' in overrides ? overrides.generation! : this._generation,
            'coveredFrontier' in overrides ? overrides.coveredFrontier! : this._coveredFrontier,
            'definitions' in overrides ? overrides.definitions! : this._definitions,
            'relations' in overrides ? overrides.relations! : this._relations,
            'bindings' in overrides ? overrides.bindings! : this._bindings,
            'events' in overrides ? overrides.events! : this._events,
            'actors' in overrides ? overrides.actors! : this._actors,
            'selections' in overrides ? overrides.selections! : this._selections
        );
    }

    public static fromPlain(obj: {scope: string; generation: bigint; coveredFrontier: bigint; definitions: Array<Definition>; relations: Array<Relation>; bindings: Array<Binding>; events: Array<StateEvent>; actors: Array<ActorRecord>; selections: Array<BindingSelection>}): GraphSnapshot {
        return new GraphSnapshot(
            obj.scope,
            obj.generation,
            obj.coveredFrontier,
            obj.definitions,
            obj.relations,
            obj.bindings,
            obj.events,
            obj.actors,
            obj.selections
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphSnapshot.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphSnapshot.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#GraphSnapshot'
    public baboonTypeIdentifier() {
        return GraphSnapshot.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return GraphSnapshot.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return GraphSnapshot.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return GraphSnapshot.BaboonMinReaderVersions
    }
    public static jsonCodec(): GraphSnapshot_JsonCodec {
        return GraphSnapshot_JsonCodec.instance
    }
}

export class GraphSnapshot_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GraphSnapshot): unknown {
        if (this !== GraphSnapshot_JsonCodec.lazyInstance.value) {
          return GraphSnapshot_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "generation": value.generation.toString(),
            "coveredFrontier": value.coveredFrontier.toString(),
            "definitions": Array.from(value.definitions).map(item => Definition_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "relations": Array.from(value.relations).map(item => Relation_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "bindings": Array.from(value.bindings).map(item => Binding_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "events": Array.from(value.events).map(item => StateEvent_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "actors": Array.from(value.actors).map(item => ActorRecord_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "selections": Array.from(value.selections).map(item => BindingSelection_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GraphSnapshot {
        if (this !== GraphSnapshot_JsonCodec .lazyInstance.value) {
            return GraphSnapshot_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new GraphSnapshot (
            obj["scope"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
            BaboonInt64.read(obj["coveredFrontier"], "i64/u64"),
            (obj["definitions"] as unknown[]).map(item => Definition_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["relations"] as unknown[]).map(item => Relation_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["bindings"] as unknown[]).map(item => Binding_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["events"] as unknown[]).map(item => StateEvent_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["actors"] as unknown[]).map(item => ActorRecord_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["selections"] as unknown[]).map(item => BindingSelection_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return GraphSnapshot_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return GraphSnapshot_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#GraphSnapshot'
    public baboonTypeIdentifier() {
        return GraphSnapshot_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GraphSnapshot_JsonCodec())
    public static get instance(): GraphSnapshot_JsonCodec {
        return GraphSnapshot_JsonCodec.lazyInstance.value
    }
}