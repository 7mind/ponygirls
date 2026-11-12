import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CoordinatorFence, CoordinatorFence_JsonCodec} from './CoordinatorFence.js'
import {CurationAuditPayload, CurationAuditPayload_JsonCodec} from './CurationAuditPayload.js'
import {CurationAuditStage, CurationAuditStage_JsonCodec} from './CurationAuditStage.js'

export class CurationAuditRecord implements BaboonGeneratedLatest {
    private readonly _attemptId: string;
    private readonly _scope: string;
    private readonly _fence: CoordinatorFence;
    private readonly _ordinal: number;
    private readonly _stage: CurationAuditStage;
    private readonly _requestDigest: string;
    private readonly _payload: CurationAuditPayload | undefined;
    private readonly _observedAt: string;

    constructor(attemptId: string, scope: string, fence: CoordinatorFence, ordinal: number, stage: CurationAuditStage, requestDigest: string, payload: CurationAuditPayload | undefined, observedAt: string) {
        this._attemptId = attemptId
        this._scope = scope
        this._fence = fence
        this._ordinal = ordinal
        this._stage = stage
        this._requestDigest = requestDigest
        this._payload = payload
        this._observedAt = observedAt
    }

    public get attemptId(): string {
        return this._attemptId;
    }
    public get scope(): string {
        return this._scope;
    }
    public get fence(): CoordinatorFence {
        return this._fence;
    }
    public get ordinal(): number {
        return this._ordinal;
    }
    public get stage(): CurationAuditStage {
        return this._stage;
    }
    public get requestDigest(): string {
        return this._requestDigest;
    }
    public get payload(): CurationAuditPayload | undefined {
        return this._payload;
    }
    public get observedAt(): string {
        return this._observedAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            attemptId: this._attemptId,
            scope: this._scope,
            fence: this._fence,
            ordinal: this._ordinal,
            stage: this._stage,
            requestDigest: this._requestDigest,
            payload: this._payload !== undefined ? this._payload : undefined,
            observedAt: this._observedAt
        };
    }

    public with(overrides: {attemptId?: string; scope?: string; fence?: CoordinatorFence; ordinal?: number; stage?: CurationAuditStage; requestDigest?: string; payload?: CurationAuditPayload | undefined; observedAt?: string}): CurationAuditRecord {
        return new CurationAuditRecord(
            'attemptId' in overrides ? overrides.attemptId! : this._attemptId,
            'scope' in overrides ? overrides.scope! : this._scope,
            'fence' in overrides ? overrides.fence! : this._fence,
            'ordinal' in overrides ? overrides.ordinal! : this._ordinal,
            'stage' in overrides ? overrides.stage! : this._stage,
            'requestDigest' in overrides ? overrides.requestDigest! : this._requestDigest,
            'payload' in overrides ? overrides.payload! : this._payload,
            'observedAt' in overrides ? overrides.observedAt! : this._observedAt
        );
    }

    public static fromPlain(obj: {attemptId: string; scope: string; fence: CoordinatorFence; ordinal: number; stage: CurationAuditStage; requestDigest: string; payload: CurationAuditPayload | undefined; observedAt: string}): CurationAuditRecord {
        return new CurationAuditRecord(
            obj.attemptId,
            obj.scope,
            obj.fence,
            obj.ordinal,
            obj.stage,
            obj.requestDigest,
            obj.payload,
            obj.observedAt
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationAuditRecord.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationAuditRecord.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationAuditRecord'
    public baboonTypeIdentifier() {
        return CurationAuditRecord.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CurationAuditRecord.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CurationAuditRecord.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CurationAuditRecord.BaboonMinReaderVersions
    }
    public static jsonCodec(): CurationAuditRecord_JsonCodec {
        return CurationAuditRecord_JsonCodec.instance
    }
}

export class CurationAuditRecord_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationAuditRecord): unknown {
        if (this !== CurationAuditRecord_JsonCodec.lazyInstance.value) {
          return CurationAuditRecord_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "attemptId": value.attemptId,
            "scope": value.scope,
            "fence": CoordinatorFence_JsonCodec.instance.encode(BaboonCodecContext.Default, value.fence),
            "ordinal": value.ordinal,
            "stage": CurationAuditStage_JsonCodec.instance.encode(BaboonCodecContext.Default, value.stage),
            "requestDigest": value.requestDigest,
            "payload": value.payload === undefined ? null : CurationAuditPayload_JsonCodec.instance.encode(BaboonCodecContext.Default, value.payload),
            "observedAt": value.observedAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationAuditRecord {
        if (this !== CurationAuditRecord_JsonCodec .lazyInstance.value) {
            return CurationAuditRecord_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CurationAuditRecord (
            obj["attemptId"] as string,
            obj["scope"] as string,
            CoordinatorFence_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["fence"]),
            obj["ordinal"] as number,
            CurationAuditStage_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["stage"]),
            obj["requestDigest"] as string,
            obj["payload"] === undefined || obj["payload"] === null ? undefined : obj["payload"] === undefined || obj["payload"] === null ? undefined : CurationAuditPayload_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["payload"]),
            obj["observedAt"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationAuditRecord_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationAuditRecord_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationAuditRecord'
    public baboonTypeIdentifier() {
        return CurationAuditRecord_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationAuditRecord_JsonCodec())
    public static get instance(): CurationAuditRecord_JsonCodec {
        return CurationAuditRecord_JsonCodec.lazyInstance.value
    }
}