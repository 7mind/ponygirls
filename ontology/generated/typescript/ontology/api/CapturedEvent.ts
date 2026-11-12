import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {CaptureMetadata, CaptureMetadata_JsonCodec} from './CaptureMetadata.js'
import {ContextRecord, ContextRecord_JsonCodec} from './ContextRecord.js'
import {EventOrigin, EventOrigin_JsonCodec} from './EventOrigin.js'
import {Observation, Observation_JsonCodec} from './Observation.js'
import {Provenance, Provenance_JsonCodec} from './Provenance.js'
import {ReviewResponseLink, ReviewResponseLink_JsonCodec} from './ReviewResponseLink.js'

export class CapturedEvent implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _scope: string;
    private readonly _sourceNamespace: string;
    private readonly _frontier: bigint;
    private readonly _context: ContextRecord;
    private readonly _origin: EventOrigin;
    private readonly _metadata: CaptureMetadata;
    private readonly _text: string;
    private readonly _observation: Observation;
    private readonly _reviewResponse: ReviewResponseLink | undefined;
    private readonly _provenance: Provenance;

    constructor(id: string, scope: string, sourceNamespace: string, frontier: bigint, context: ContextRecord, origin: EventOrigin, metadata: CaptureMetadata, text: string, observation: Observation, reviewResponse: ReviewResponseLink | undefined, provenance: Provenance) {
        this._id = id
        this._scope = scope
        this._sourceNamespace = sourceNamespace
        this._frontier = frontier
        this._context = context
        this._origin = origin
        this._metadata = metadata
        this._text = text
        this._observation = observation
        this._reviewResponse = reviewResponse
        this._provenance = provenance
    }

    public get id(): string {
        return this._id;
    }
    public get scope(): string {
        return this._scope;
    }
    public get sourceNamespace(): string {
        return this._sourceNamespace;
    }
    public get frontier(): bigint {
        return this._frontier;
    }
    public get context(): ContextRecord {
        return this._context;
    }
    public get origin(): EventOrigin {
        return this._origin;
    }
    public get metadata(): CaptureMetadata {
        return this._metadata;
    }
    public get text(): string {
        return this._text;
    }
    public get observation(): Observation {
        return this._observation;
    }
    public get reviewResponse(): ReviewResponseLink | undefined {
        return this._reviewResponse;
    }
    public get provenance(): Provenance {
        return this._provenance;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            scope: this._scope,
            sourceNamespace: this._sourceNamespace,
            frontier: this._frontier,
            context: this._context,
            origin: this._origin,
            metadata: this._metadata,
            text: this._text,
            observation: this._observation,
            reviewResponse: this._reviewResponse !== undefined ? this._reviewResponse : undefined,
            provenance: this._provenance
        };
    }

    public with(overrides: {id?: string; scope?: string; sourceNamespace?: string; frontier?: bigint; context?: ContextRecord; origin?: EventOrigin; metadata?: CaptureMetadata; text?: string; observation?: Observation; reviewResponse?: ReviewResponseLink | undefined; provenance?: Provenance}): CapturedEvent {
        return new CapturedEvent(
            'id' in overrides ? overrides.id! : this._id,
            'scope' in overrides ? overrides.scope! : this._scope,
            'sourceNamespace' in overrides ? overrides.sourceNamespace! : this._sourceNamespace,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'context' in overrides ? overrides.context! : this._context,
            'origin' in overrides ? overrides.origin! : this._origin,
            'metadata' in overrides ? overrides.metadata! : this._metadata,
            'text' in overrides ? overrides.text! : this._text,
            'observation' in overrides ? overrides.observation! : this._observation,
            'reviewResponse' in overrides ? overrides.reviewResponse! : this._reviewResponse,
            'provenance' in overrides ? overrides.provenance! : this._provenance
        );
    }

    public static fromPlain(obj: {id: string; scope: string; sourceNamespace: string; frontier: bigint; context: ContextRecord; origin: EventOrigin; metadata: CaptureMetadata; text: string; observation: Observation; reviewResponse: ReviewResponseLink | undefined; provenance: Provenance}): CapturedEvent {
        return new CapturedEvent(
            obj.id,
            obj.scope,
            obj.sourceNamespace,
            obj.frontier,
            obj.context,
            obj.origin,
            obj.metadata,
            obj.text,
            obj.observation,
            obj.reviewResponse,
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
            "sourceNamespace": value.sourceNamespace,
            "frontier": value.frontier.toString(),
            "context": ContextRecord_JsonCodec.instance.encode(BaboonCodecContext.Default, value.context),
            "origin": EventOrigin_JsonCodec.instance.encode(BaboonCodecContext.Default, value.origin),
            "metadata": CaptureMetadata_JsonCodec.instance.encode(BaboonCodecContext.Default, value.metadata),
            "text": value.text,
            "observation": Observation_JsonCodec.instance.encode(BaboonCodecContext.Default, value.observation),
            "reviewResponse": value.reviewResponse === undefined ? null : ReviewResponseLink_JsonCodec.instance.encode(BaboonCodecContext.Default, value.reviewResponse),
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
            obj["sourceNamespace"] as string,
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            ContextRecord_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["context"]),
            EventOrigin_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["origin"]),
            CaptureMetadata_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["metadata"]),
            obj["text"] as string,
            Observation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["observation"]),
            obj["reviewResponse"] === undefined || obj["reviewResponse"] === null ? undefined : obj["reviewResponse"] === undefined || obj["reviewResponse"] === null ? undefined : ReviewResponseLink_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["reviewResponse"]),
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