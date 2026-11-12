import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {CaptureMetadata, CaptureMetadata_JsonCodec} from './CaptureMetadata.js'
import {ContextRecord, ContextRecord_JsonCodec} from './ContextRecord.js'
import {EventOrigin, EventOrigin_JsonCodec} from './EventOrigin.js'
import {Observation, Observation_JsonCodec} from './Observation.js'
import {RequestTrace, RequestTrace_JsonCodec} from './RequestTrace.js'
import {ReviewResponseLink, ReviewResponseLink_JsonCodec} from './ReviewResponseLink.js'

export type SourceDescriptor = SourceDescriptor_PrimaryCapture | SourceDescriptor_DerivedPresentation

export const SourceDescriptor = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#SourceDescriptor',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#SourceDescriptor',
    jsonCodec(): SourceDescriptor_JsonCodec {
        return SourceDescriptor_JsonCodec.instance
    }
} as const

export class SourceDescriptor_PrimaryCapture implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#SourceDescriptor]#PrimaryCapture' as const;
    private readonly _eventId: string;
    private readonly _sourceNamespace: string;
    private readonly _captureContext: ContextRecord;
    private readonly _metadata: CaptureMetadata;
    private readonly _origin: EventOrigin;
    private readonly _observation: Observation;
    private readonly _reviewResponse: ReviewResponseLink | undefined;

    constructor(eventId: string, sourceNamespace: string, captureContext: ContextRecord, metadata: CaptureMetadata, origin: EventOrigin, observation: Observation, reviewResponse: ReviewResponseLink | undefined) {
        this._eventId = eventId
        this._sourceNamespace = sourceNamespace
        this._captureContext = captureContext
        this._metadata = metadata
        this._origin = origin
        this._observation = observation
        this._reviewResponse = reviewResponse
    }

    public get eventId(): string {
        return this._eventId;
    }
    public get sourceNamespace(): string {
        return this._sourceNamespace;
    }
    public get captureContext(): ContextRecord {
        return this._captureContext;
    }
    public get metadata(): CaptureMetadata {
        return this._metadata;
    }
    public get origin(): EventOrigin {
        return this._origin;
    }
    public get observation(): Observation {
        return this._observation;
    }
    public get reviewResponse(): ReviewResponseLink | undefined {
        return this._reviewResponse;
    }

    public toJSON(): Record<string, unknown> {
        return {
            eventId: this._eventId,
            sourceNamespace: this._sourceNamespace,
            captureContext: this._captureContext,
            metadata: this._metadata,
            origin: this._origin,
            observation: this._observation,
            reviewResponse: this._reviewResponse !== undefined ? this._reviewResponse : undefined
        };
    }

    public with(overrides: {eventId?: string; sourceNamespace?: string; captureContext?: ContextRecord; metadata?: CaptureMetadata; origin?: EventOrigin; observation?: Observation; reviewResponse?: ReviewResponseLink | undefined}): SourceDescriptor_PrimaryCapture {
        return new SourceDescriptor_PrimaryCapture(
            'eventId' in overrides ? overrides.eventId! : this._eventId,
            'sourceNamespace' in overrides ? overrides.sourceNamespace! : this._sourceNamespace,
            'captureContext' in overrides ? overrides.captureContext! : this._captureContext,
            'metadata' in overrides ? overrides.metadata! : this._metadata,
            'origin' in overrides ? overrides.origin! : this._origin,
            'observation' in overrides ? overrides.observation! : this._observation,
            'reviewResponse' in overrides ? overrides.reviewResponse! : this._reviewResponse
        );
    }

    public static fromPlain(obj: {eventId: string; sourceNamespace: string; captureContext: ContextRecord; metadata: CaptureMetadata; origin: EventOrigin; observation: Observation; reviewResponse: ReviewResponseLink | undefined}): SourceDescriptor_PrimaryCapture {
        return new SourceDescriptor_PrimaryCapture(
            obj.eventId,
            obj.sourceNamespace,
            obj.captureContext,
            obj.metadata,
            obj.origin,
            obj.observation,
            obj.reviewResponse
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SourceDescriptor_PrimaryCapture.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return SourceDescriptor_PrimaryCapture.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#SourceDescriptor]#PrimaryCapture'
    public baboonTypeIdentifier() {
        return SourceDescriptor_PrimaryCapture.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return SourceDescriptor_PrimaryCapture.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return SourceDescriptor_PrimaryCapture.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return SourceDescriptor_PrimaryCapture.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#SourceDescriptor'
    public baboonAdtTypeIdentifier() {
        return SourceDescriptor_PrimaryCapture.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): SourceDescriptor_PrimaryCapture_JsonCodec {
        return SourceDescriptor_PrimaryCapture_JsonCodec.instance
    }
}

export class SourceDescriptor_PrimaryCapture_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SourceDescriptor_PrimaryCapture): unknown {
        if (this !== SourceDescriptor_PrimaryCapture_JsonCodec.lazyInstance.value) {
          return SourceDescriptor_PrimaryCapture_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "eventId": value.eventId,
            "sourceNamespace": value.sourceNamespace,
            "captureContext": ContextRecord_JsonCodec.instance.encode(BaboonCodecContext.Default, value.captureContext),
            "metadata": CaptureMetadata_JsonCodec.instance.encode(BaboonCodecContext.Default, value.metadata),
            "origin": EventOrigin_JsonCodec.instance.encode(BaboonCodecContext.Default, value.origin),
            "observation": Observation_JsonCodec.instance.encode(BaboonCodecContext.Default, value.observation),
            "reviewResponse": value.reviewResponse === undefined ? null : ReviewResponseLink_JsonCodec.instance.encode(BaboonCodecContext.Default, value.reviewResponse),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SourceDescriptor_PrimaryCapture {
        if (this !== SourceDescriptor_PrimaryCapture_JsonCodec .lazyInstance.value) {
            return SourceDescriptor_PrimaryCapture_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SourceDescriptor_PrimaryCapture (
            obj["eventId"] as string,
            obj["sourceNamespace"] as string,
            ContextRecord_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["captureContext"]),
            CaptureMetadata_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["metadata"]),
            EventOrigin_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["origin"]),
            Observation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["observation"]),
            obj["reviewResponse"] === undefined || obj["reviewResponse"] === null ? undefined : obj["reviewResponse"] === undefined || obj["reviewResponse"] === null ? undefined : ReviewResponseLink_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["reviewResponse"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SourceDescriptor_PrimaryCapture_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return SourceDescriptor_PrimaryCapture_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#SourceDescriptor]#PrimaryCapture'
    public baboonTypeIdentifier() {
        return SourceDescriptor_PrimaryCapture_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#SourceDescriptor'
    public baboonAdtTypeIdentifier() {
        return SourceDescriptor_PrimaryCapture_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SourceDescriptor_PrimaryCapture_JsonCodec())
    public static get instance(): SourceDescriptor_PrimaryCapture_JsonCodec {
        return SourceDescriptor_PrimaryCapture_JsonCodec.lazyInstance.value
    }
}

export class SourceDescriptor_DerivedPresentation implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#SourceDescriptor]#DerivedPresentation' as const;
    private readonly _presentationId: string;
    private readonly _generation: bigint;
    private readonly _payloadDigest: string;
    private readonly _preparedAt: string;
    private readonly _preparationTrace: RequestTrace;

    constructor(presentationId: string, generation: bigint, payloadDigest: string, preparedAt: string, preparationTrace: RequestTrace) {
        this._presentationId = presentationId
        this._generation = generation
        this._payloadDigest = payloadDigest
        this._preparedAt = preparedAt
        this._preparationTrace = preparationTrace
    }

    public get presentationId(): string {
        return this._presentationId;
    }
    public get generation(): bigint {
        return this._generation;
    }
    public get payloadDigest(): string {
        return this._payloadDigest;
    }
    public get preparedAt(): string {
        return this._preparedAt;
    }
    public get preparationTrace(): RequestTrace {
        return this._preparationTrace;
    }

    public toJSON(): Record<string, unknown> {
        return {
            presentationId: this._presentationId,
            generation: this._generation,
            payloadDigest: this._payloadDigest,
            preparedAt: this._preparedAt,
            preparationTrace: this._preparationTrace
        };
    }

    public with(overrides: {presentationId?: string; generation?: bigint; payloadDigest?: string; preparedAt?: string; preparationTrace?: RequestTrace}): SourceDescriptor_DerivedPresentation {
        return new SourceDescriptor_DerivedPresentation(
            'presentationId' in overrides ? overrides.presentationId! : this._presentationId,
            'generation' in overrides ? overrides.generation! : this._generation,
            'payloadDigest' in overrides ? overrides.payloadDigest! : this._payloadDigest,
            'preparedAt' in overrides ? overrides.preparedAt! : this._preparedAt,
            'preparationTrace' in overrides ? overrides.preparationTrace! : this._preparationTrace
        );
    }

    public static fromPlain(obj: {presentationId: string; generation: bigint; payloadDigest: string; preparedAt: string; preparationTrace: RequestTrace}): SourceDescriptor_DerivedPresentation {
        return new SourceDescriptor_DerivedPresentation(
            obj.presentationId,
            obj.generation,
            obj.payloadDigest,
            obj.preparedAt,
            obj.preparationTrace
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SourceDescriptor_DerivedPresentation.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return SourceDescriptor_DerivedPresentation.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#SourceDescriptor]#DerivedPresentation'
    public baboonTypeIdentifier() {
        return SourceDescriptor_DerivedPresentation.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return SourceDescriptor_DerivedPresentation.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return SourceDescriptor_DerivedPresentation.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return SourceDescriptor_DerivedPresentation.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#SourceDescriptor'
    public baboonAdtTypeIdentifier() {
        return SourceDescriptor_DerivedPresentation.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): SourceDescriptor_DerivedPresentation_JsonCodec {
        return SourceDescriptor_DerivedPresentation_JsonCodec.instance
    }
}

export class SourceDescriptor_DerivedPresentation_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SourceDescriptor_DerivedPresentation): unknown {
        if (this !== SourceDescriptor_DerivedPresentation_JsonCodec.lazyInstance.value) {
          return SourceDescriptor_DerivedPresentation_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "presentationId": value.presentationId,
            "generation": value.generation.toString(),
            "payloadDigest": value.payloadDigest,
            "preparedAt": value.preparedAt,
            "preparationTrace": RequestTrace_JsonCodec.instance.encode(BaboonCodecContext.Default, value.preparationTrace),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SourceDescriptor_DerivedPresentation {
        if (this !== SourceDescriptor_DerivedPresentation_JsonCodec .lazyInstance.value) {
            return SourceDescriptor_DerivedPresentation_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SourceDescriptor_DerivedPresentation (
            obj["presentationId"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
            obj["payloadDigest"] as string,
            obj["preparedAt"] as string,
            RequestTrace_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["preparationTrace"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SourceDescriptor_DerivedPresentation_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return SourceDescriptor_DerivedPresentation_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#SourceDescriptor]#DerivedPresentation'
    public baboonTypeIdentifier() {
        return SourceDescriptor_DerivedPresentation_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#SourceDescriptor'
    public baboonAdtTypeIdentifier() {
        return SourceDescriptor_DerivedPresentation_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SourceDescriptor_DerivedPresentation_JsonCodec())
    public static get instance(): SourceDescriptor_DerivedPresentation_JsonCodec {
        return SourceDescriptor_DerivedPresentation_JsonCodec.lazyInstance.value
    }
}


export class SourceDescriptor_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SourceDescriptor): unknown {
        if (this !== SourceDescriptor_JsonCodec.lazyInstance.value) {
          return SourceDescriptor_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof SourceDescriptor_PrimaryCapture) {
                return { "PrimaryCapture": SourceDescriptor_PrimaryCapture_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof SourceDescriptor_DerivedPresentation) {
                return { "DerivedPresentation": SourceDescriptor_DerivedPresentation_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SourceDescriptor {
        if (this !== SourceDescriptor_JsonCodec .lazyInstance.value) {
            return SourceDescriptor_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "PrimaryCapture": return SourceDescriptor_PrimaryCapture_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "DerivedPresentation": return SourceDescriptor_DerivedPresentation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SourceDescriptor_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return SourceDescriptor_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#SourceDescriptor'
    public baboonTypeIdentifier() {
        return SourceDescriptor_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#SourceDescriptor'
    public baboonAdtTypeIdentifier() {
        return SourceDescriptor_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SourceDescriptor_JsonCodec())
    public static get instance(): SourceDescriptor_JsonCodec {
        return SourceDescriptor_JsonCodec.lazyInstance.value
    }
}