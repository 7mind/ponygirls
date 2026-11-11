import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CaptureMetadata, CaptureMetadata_JsonCodec} from './CaptureMetadata.js'
import {ContextRecordInput, ContextRecordInput_JsonCodec} from './ContextRecordInput.js'
import {EventOrigin, EventOrigin_JsonCodec} from './EventOrigin.js'
import {Observation, Observation_JsonCodec} from './Observation.js'

export class IngestRequest implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _requestId: string;
    private readonly _eventId: string;
    private readonly _occurrenceContext: ContextRecordInput | undefined;
    private readonly _contributionContext: ContextRecordInput | undefined;
    private readonly _origin: EventOrigin;
    private readonly _metadata: CaptureMetadata;
    private readonly _text: string;
    private readonly _observation: Observation;

    constructor(scope: string, requestId: string, eventId: string, occurrenceContext: ContextRecordInput | undefined, contributionContext: ContextRecordInput | undefined, origin: EventOrigin, metadata: CaptureMetadata, text: string, observation: Observation) {
        this._scope = scope
        this._requestId = requestId
        this._eventId = eventId
        this._occurrenceContext = occurrenceContext
        this._contributionContext = contributionContext
        this._origin = origin
        this._metadata = metadata
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
    public get occurrenceContext(): ContextRecordInput | undefined {
        return this._occurrenceContext;
    }
    public get contributionContext(): ContextRecordInput | undefined {
        return this._contributionContext;
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

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            requestId: this._requestId,
            eventId: this._eventId,
            occurrenceContext: this._occurrenceContext !== undefined ? this._occurrenceContext : undefined,
            contributionContext: this._contributionContext !== undefined ? this._contributionContext : undefined,
            origin: this._origin,
            metadata: this._metadata,
            text: this._text,
            observation: this._observation
        };
    }

    public with(overrides: {scope?: string; requestId?: string; eventId?: string; occurrenceContext?: ContextRecordInput | undefined; contributionContext?: ContextRecordInput | undefined; origin?: EventOrigin; metadata?: CaptureMetadata; text?: string; observation?: Observation}): IngestRequest {
        return new IngestRequest(
            'scope' in overrides ? overrides.scope! : this._scope,
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'eventId' in overrides ? overrides.eventId! : this._eventId,
            'occurrenceContext' in overrides ? overrides.occurrenceContext! : this._occurrenceContext,
            'contributionContext' in overrides ? overrides.contributionContext! : this._contributionContext,
            'origin' in overrides ? overrides.origin! : this._origin,
            'metadata' in overrides ? overrides.metadata! : this._metadata,
            'text' in overrides ? overrides.text! : this._text,
            'observation' in overrides ? overrides.observation! : this._observation
        );
    }

    public static fromPlain(obj: {scope: string; requestId: string; eventId: string; occurrenceContext: ContextRecordInput | undefined; contributionContext: ContextRecordInput | undefined; origin: EventOrigin; metadata: CaptureMetadata; text: string; observation: Observation}): IngestRequest {
        return new IngestRequest(
            obj.scope,
            obj.requestId,
            obj.eventId,
            obj.occurrenceContext,
            obj.contributionContext,
            obj.origin,
            obj.metadata,
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
            "occurrenceContext": value.occurrenceContext === undefined ? null : ContextRecordInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.occurrenceContext),
            "contributionContext": value.contributionContext === undefined ? null : ContextRecordInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.contributionContext),
            "origin": EventOrigin_JsonCodec.instance.encode(BaboonCodecContext.Default, value.origin),
            "metadata": CaptureMetadata_JsonCodec.instance.encode(BaboonCodecContext.Default, value.metadata),
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
            obj["occurrenceContext"] === undefined || obj["occurrenceContext"] === null ? undefined : obj["occurrenceContext"] === undefined || obj["occurrenceContext"] === null ? undefined : ContextRecordInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["occurrenceContext"]),
            obj["contributionContext"] === undefined || obj["contributionContext"] === null ? undefined : obj["contributionContext"] === undefined || obj["contributionContext"] === null ? undefined : ContextRecordInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["contributionContext"]),
            EventOrigin_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["origin"]),
            CaptureMetadata_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["metadata"]),
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