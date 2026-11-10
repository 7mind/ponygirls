import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CaptureContext, CaptureContext_JsonCodec} from './CaptureContext.js'
import {EventOrigin, EventOrigin_JsonCodec} from './EventOrigin.js'
import {Observation, Observation_JsonCodec} from './Observation.js'

export class IngestRequest implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _requestId: string;
    private readonly _eventId: string;
    private readonly _context: CaptureContext;
    private readonly _origin: EventOrigin;
    private readonly _text: string;
    private readonly _observation: Observation;

    constructor(scope: string, requestId: string, eventId: string, context: CaptureContext, origin: EventOrigin, text: string, observation: Observation) {
        this._scope = scope
        this._requestId = requestId
        this._eventId = eventId
        this._context = context
        this._origin = origin
        this._text = text
        this._observation = observation
    }

    public get scope(): string {
        return this._scope;
    }
    public get requestId(): string {
        return this._requestId;
    }
    public get eventId(): string {
        return this._eventId;
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

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            requestId: this._requestId,
            eventId: this._eventId,
            context: this._context,
            origin: this._origin,
            text: this._text,
            observation: this._observation
        };
    }

    public with(overrides: {scope?: string; requestId?: string; eventId?: string; context?: CaptureContext; origin?: EventOrigin; text?: string; observation?: Observation}): IngestRequest {
        return new IngestRequest(
            'scope' in overrides ? overrides.scope! : this._scope,
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'eventId' in overrides ? overrides.eventId! : this._eventId,
            'context' in overrides ? overrides.context! : this._context,
            'origin' in overrides ? overrides.origin! : this._origin,
            'text' in overrides ? overrides.text! : this._text,
            'observation' in overrides ? overrides.observation! : this._observation
        );
    }

    public static fromPlain(obj: {scope: string; requestId: string; eventId: string; context: CaptureContext; origin: EventOrigin; text: string; observation: Observation}): IngestRequest {
        return new IngestRequest(
            obj.scope,
            obj.requestId,
            obj.eventId,
            obj.context,
            obj.origin,
            obj.text,
            obj.observation
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return IngestRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return IngestRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#IngestRequest'
    public baboonTypeIdentifier() {
        return IngestRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return IngestRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return IngestRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return IngestRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): IngestRequest_JsonCodec {
        return IngestRequest_JsonCodec.instance
    }
}

export class IngestRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: IngestRequest): unknown {
        if (this !== IngestRequest_JsonCodec.lazyInstance.value) {
          return IngestRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "requestId": value.requestId,
            "eventId": value.eventId,
            "context": CaptureContext_JsonCodec.instance.encode(BaboonCodecContext.Default, value.context),
            "origin": EventOrigin_JsonCodec.instance.encode(BaboonCodecContext.Default, value.origin),
            "text": value.text,
            "observation": Observation_JsonCodec.instance.encode(BaboonCodecContext.Default, value.observation),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): IngestRequest {
        if (this !== IngestRequest_JsonCodec .lazyInstance.value) {
            return IngestRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new IngestRequest (
            obj["scope"] as string,
            obj["requestId"] as string,
            obj["eventId"] as string,
            CaptureContext_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["context"]),
            EventOrigin_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["origin"]),
            obj["text"] as string,
            Observation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["observation"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return IngestRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return IngestRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#IngestRequest'
    public baboonTypeIdentifier() {
        return IngestRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new IngestRequest_JsonCodec())
    public static get instance(): IngestRequest_JsonCodec {
        return IngestRequest_JsonCodec.lazyInstance.value
    }
}