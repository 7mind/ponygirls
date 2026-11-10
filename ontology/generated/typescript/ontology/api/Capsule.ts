import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {CaptureContext, CaptureContext_JsonCodec} from './CaptureContext.js'
import {CapturedEvent, CapturedEvent_JsonCodec} from './CapturedEvent.js'
import {Definition, Definition_JsonCodec} from './Definition.js'
import {GoverningChange, GoverningChange_JsonCodec} from './GoverningChange.js'
import {Relation, Relation_JsonCodec} from './Relation.js'

export class Capsule implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _scope: string;
    private readonly _generation: bigint;
    private readonly _frontier: bigint;
    private readonly _coveredFrontier: bigint;
    private readonly _context: CaptureContext;
    private readonly _current: Array<Definition>;
    private readonly _relations: Array<Relation>;
    private readonly _observations: Array<CapturedEvent>;
    private readonly _changes: Array<GoverningChange>;
    private readonly _qualifications: Array<string>;
    private readonly _text: string;

    constructor(id: string, scope: string, generation: bigint, frontier: bigint, coveredFrontier: bigint, context: CaptureContext, current: Array<Definition>, relations: Array<Relation>, observations: Array<CapturedEvent>, changes: Array<GoverningChange>, qualifications: Array<string>, text: string) {
        this._id = id
        this._scope = scope
        this._generation = generation
        this._frontier = frontier
        this._coveredFrontier = coveredFrontier
        this._context = context
        this._current = current
        this._relations = relations
        this._observations = observations
        this._changes = changes
        this._qualifications = qualifications
        this._text = text
    }

    public get id(): string {
        return this._id;
    }
    public get scope(): string {
        return this._scope;
    }
    public get generation(): bigint {
        return this._generation;
    }
    public get frontier(): bigint {
        return this._frontier;
    }
    public get coveredFrontier(): bigint {
        return this._coveredFrontier;
    }
    public get context(): CaptureContext {
        return this._context;
    }
    public get current(): Array<Definition> {
        return this._current;
    }
    public get relations(): Array<Relation> {
        return this._relations;
    }
    public get observations(): Array<CapturedEvent> {
        return this._observations;
    }
    public get changes(): Array<GoverningChange> {
        return this._changes;
    }
    public get qualifications(): Array<string> {
        return this._qualifications;
    }
    public get text(): string {
        return this._text;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            scope: this._scope,
            generation: this._generation,
            frontier: this._frontier,
            coveredFrontier: this._coveredFrontier,
            context: this._context,
            current: this._current,
            relations: this._relations,
            observations: this._observations,
            changes: this._changes,
            qualifications: this._qualifications,
            text: this._text
        };
    }

    public with(overrides: {id?: string; scope?: string; generation?: bigint; frontier?: bigint; coveredFrontier?: bigint; context?: CaptureContext; current?: Array<Definition>; relations?: Array<Relation>; observations?: Array<CapturedEvent>; changes?: Array<GoverningChange>; qualifications?: Array<string>; text?: string}): Capsule {
        return new Capsule(
            'id' in overrides ? overrides.id! : this._id,
            'scope' in overrides ? overrides.scope! : this._scope,
            'generation' in overrides ? overrides.generation! : this._generation,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'coveredFrontier' in overrides ? overrides.coveredFrontier! : this._coveredFrontier,
            'context' in overrides ? overrides.context! : this._context,
            'current' in overrides ? overrides.current! : this._current,
            'relations' in overrides ? overrides.relations! : this._relations,
            'observations' in overrides ? overrides.observations! : this._observations,
            'changes' in overrides ? overrides.changes! : this._changes,
            'qualifications' in overrides ? overrides.qualifications! : this._qualifications,
            'text' in overrides ? overrides.text! : this._text
        );
    }

    public static fromPlain(obj: {id: string; scope: string; generation: bigint; frontier: bigint; coveredFrontier: bigint; context: CaptureContext; current: Array<Definition>; relations: Array<Relation>; observations: Array<CapturedEvent>; changes: Array<GoverningChange>; qualifications: Array<string>; text: string}): Capsule {
        return new Capsule(
            obj.id,
            obj.scope,
            obj.generation,
            obj.frontier,
            obj.coveredFrontier,
            obj.context,
            obj.current,
            obj.relations,
            obj.observations,
            obj.changes,
            obj.qualifications,
            obj.text
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Capsule.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Capsule.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Capsule'
    public baboonTypeIdentifier() {
        return Capsule.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Capsule.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Capsule.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Capsule.BaboonMinReaderVersions
    }
    public static jsonCodec(): Capsule_JsonCodec {
        return Capsule_JsonCodec.instance
    }
}

export class Capsule_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Capsule): unknown {
        if (this !== Capsule_JsonCodec.lazyInstance.value) {
          return Capsule_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "scope": value.scope,
            "generation": value.generation.toString(),
            "frontier": value.frontier.toString(),
            "coveredFrontier": value.coveredFrontier.toString(),
            "context": CaptureContext_JsonCodec.instance.encode(BaboonCodecContext.Default, value.context),
            "current": Array.from(value.current).map(item => Definition_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "relations": Array.from(value.relations).map(item => Relation_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "observations": Array.from(value.observations).map(item => CapturedEvent_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "changes": Array.from(value.changes).map(item => GoverningChange_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "qualifications": Array.from(value.qualifications),
            "text": value.text,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Capsule {
        if (this !== Capsule_JsonCodec .lazyInstance.value) {
            return Capsule_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Capsule (
            obj["id"] as string,
            obj["scope"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            BaboonInt64.read(obj["coveredFrontier"], "i64/u64"),
            CaptureContext_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["context"]),
            (obj["current"] as unknown[]).map(item => Definition_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["relations"] as unknown[]).map(item => Relation_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["observations"] as unknown[]).map(item => CapturedEvent_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["changes"] as unknown[]).map(item => GoverningChange_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["qualifications"] as unknown[]).map(item => item as string),
            obj["text"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Capsule_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Capsule_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Capsule'
    public baboonTypeIdentifier() {
        return Capsule_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Capsule_JsonCodec())
    public static get instance(): Capsule_JsonCodec {
        return Capsule_JsonCodec.lazyInstance.value
    }
}