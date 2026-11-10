import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {CaptureContext, CaptureContext_JsonCodec} from './CaptureContext.js'
import {EventOrigin, EventOrigin_JsonCodec} from './EventOrigin.js'
import {Observation, Observation_JsonCodec} from './Observation.js'
import {Provenance, Provenance_JsonCodec} from './Provenance.js'

export class CapturedEvent implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _scope: string;
    private readonly _frontier: bigint;
    private readonly _context: CaptureContext;
    private readonly _origin: EventOrigin;
    private readonly _text: string;
    private readonly _observation: Observation;
    private readonly _provenance: Provenance;

    constructor(id: string, scope: string, frontier: bigint, context: CaptureContext, origin: EventOrigin, text: string, observation: Observation, provenance: Provenance) {
        this._id = id
        this._scope = scope
        this._frontier = frontier
        this._context = context
        this._origin = origin
        this._text = text
        this._observation = observation
        this._provenance = provenance
    }

    public get id(): string {
        return this._id;
    }
    public get scope(): string {
        return this._scope;
    }
    public get frontier(): bigint {
        return this._frontier;
    }
    public get context(): CaptureContext {
        return this._context;
    }
    public get origin(): EventOrigin {
        return this._origin;
    }
    public get text(): string {
        return this._text;
    }
    public get observation(): Observation {
        return this._observation;
    }
    public get provenance(): Provenance {
        return this._provenance;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            scope: this._scope,
            frontier: this._frontier,
            context: this._context,
            origin: this._origin,
            text: this._text,
            observation: this._observation,
            provenance: this._provenance
        };
    }

    public with(overrides: {id?: string; scope?: string; frontier?: bigint; context?: CaptureContext; origin?: EventOrigin; text?: string; observation?: Observation; provenance?: Provenance}): CapturedEvent {
        return new CapturedEvent(
            'id' in overrides ? overrides.id! : this._id,
            'scope' in overrides ? overrides.scope! : this._scope,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'context' in overrides ? overrides.context! : this._context,
            'origin' in overrides ? overrides.origin! : this._origin,
            'text' in overrides ? overrides.text! : this._text,
            'observation' in overrides ? overrides.observation! : this._observation,
            'provenance' in overrides ? overrides.provenance! : this._provenance
        );
    }

    public static fromPlain(obj: {id: string; scope: string; frontier: bigint; context: CaptureContext; origin: EventOrigin; text: string; observation: Observation; provenance: Provenance}): CapturedEvent {
        return new CapturedEvent(
            obj.id,
            obj.scope,
            obj.frontier,
            obj.context,
            obj.origin,
            obj.text,
            obj.observation,
            obj.provenance
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapturedEvent.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapturedEvent.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapturedEvent'
    public baboonTypeIdentifier() {
        return CapturedEvent.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CapturedEvent.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CapturedEvent.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CapturedEvent.BaboonMinReaderVersions
    }
    public static jsonCodec(): CapturedEvent_JsonCodec {
        return CapturedEvent_JsonCodec.instance
    }
}

export class CapturedEvent_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CapturedEvent): unknown {
        if (this !== CapturedEvent_JsonCodec.lazyInstance.value) {
          return CapturedEvent_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "scope": value.scope,
            "frontier": value.frontier.toString(),
            "context": CaptureContext_JsonCodec.instance.encode(BaboonCodecContext.Default, value.context),
            "origin": EventOrigin_JsonCodec.instance.encode(BaboonCodecContext.Default, value.origin),
            "text": value.text,
            "observation": Observation_JsonCodec.instance.encode(BaboonCodecContext.Default, value.observation),
            "provenance": Provenance_JsonCodec.instance.encode(BaboonCodecContext.Default, value.provenance),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CapturedEvent {
        if (this !== CapturedEvent_JsonCodec .lazyInstance.value) {
            return CapturedEvent_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CapturedEvent (
            obj["id"] as string,
            obj["scope"] as string,
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            CaptureContext_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["context"]),
            EventOrigin_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["origin"]),
            obj["text"] as string,
            Observation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["observation"]),
            Provenance_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["provenance"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapturedEvent_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapturedEvent_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapturedEvent'
    public baboonTypeIdentifier() {
        return CapturedEvent_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CapturedEvent_JsonCodec())
    public static get instance(): CapturedEvent_JsonCodec {
        return CapturedEvent_JsonCodec.lazyInstance.value
    }
}