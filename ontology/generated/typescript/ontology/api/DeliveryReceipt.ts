import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Actor, Actor_JsonCodec} from './Actor.js'
import {CapsuleCut, CapsuleCut_JsonCodec} from './CapsuleCut.js'
import {ContextRecord, ContextRecord_JsonCodec} from './ContextRecord.js'
import {DeliveryBoundary, DeliveryBoundary_JsonCodec} from './DeliveryBoundary.js'
import {DeliveryCutComparison, DeliveryCutComparison_JsonCodec} from './DeliveryCutComparison.js'
import {ReportedBoundaryDigest, ReportedBoundaryDigest_JsonCodec} from './ReportedBoundaryDigest.js'
import {RequestTrace, RequestTrace_JsonCodec} from './RequestTrace.js'

export class DeliveryReceipt implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _requestId: string;
    private readonly _owner: Actor;
    private readonly _scope: string;
    private readonly _capsuleId: string;
    private readonly _capsulePayloadDigest: string;
    private readonly _workContext: string;
    private readonly _reportedContext: ContextRecord;
    private readonly _boundary: DeliveryBoundary;
    private readonly _reportedAt: string | undefined;
    private readonly _reportedBoundaryPayload: ReportedBoundaryDigest | undefined;
    private readonly _receivedAt: string;
    private readonly _ingress: RequestTrace;
    private readonly _observedCut: CapsuleCut;
    private readonly _cutComparison: DeliveryCutComparison;

    constructor(id: string, requestId: string, owner: Actor, scope: string, capsuleId: string, capsulePayloadDigest: string, workContext: string, reportedContext: ContextRecord, boundary: DeliveryBoundary, reportedAt: string | undefined, reportedBoundaryPayload: ReportedBoundaryDigest | undefined, receivedAt: string, ingress: RequestTrace, observedCut: CapsuleCut, cutComparison: DeliveryCutComparison) {
        this._id = id
        this._requestId = requestId
        this._owner = owner
        this._scope = scope
        this._capsuleId = capsuleId
        this._capsulePayloadDigest = capsulePayloadDigest
        this._workContext = workContext
        this._reportedContext = reportedContext
        this._boundary = boundary
        this._reportedAt = reportedAt
        this._reportedBoundaryPayload = reportedBoundaryPayload
        this._receivedAt = receivedAt
        this._ingress = ingress
        this._observedCut = observedCut
        this._cutComparison = cutComparison
    }

    public get id(): string {
        return this._id;
    }
    public get requestId(): string {
        return this._requestId;
    }
    public get owner(): Actor {
        return this._owner;
    }
    public get scope(): string {
        return this._scope;
    }
    public get capsuleId(): string {
        return this._capsuleId;
    }
    public get capsulePayloadDigest(): string {
        return this._capsulePayloadDigest;
    }
    public get workContext(): string {
        return this._workContext;
    }
    public get reportedContext(): ContextRecord {
        return this._reportedContext;
    }
    public get boundary(): DeliveryBoundary {
        return this._boundary;
    }
    public get reportedAt(): string | undefined {
        return this._reportedAt;
    }
    public get reportedBoundaryPayload(): ReportedBoundaryDigest | undefined {
        return this._reportedBoundaryPayload;
    }
    public get receivedAt(): string {
        return this._receivedAt;
    }
    public get ingress(): RequestTrace {
        return this._ingress;
    }
    public get observedCut(): CapsuleCut {
        return this._observedCut;
    }
    public get cutComparison(): DeliveryCutComparison {
        return this._cutComparison;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            requestId: this._requestId,
            owner: this._owner,
            scope: this._scope,
            capsuleId: this._capsuleId,
            capsulePayloadDigest: this._capsulePayloadDigest,
            workContext: this._workContext,
            reportedContext: this._reportedContext,
            boundary: this._boundary,
            reportedAt: this._reportedAt !== undefined ? this._reportedAt : undefined,
            reportedBoundaryPayload: this._reportedBoundaryPayload !== undefined ? this._reportedBoundaryPayload : undefined,
            receivedAt: this._receivedAt,
            ingress: this._ingress,
            observedCut: this._observedCut,
            cutComparison: this._cutComparison
        };
    }

    public with(overrides: {id?: string; requestId?: string; owner?: Actor; scope?: string; capsuleId?: string; capsulePayloadDigest?: string; workContext?: string; reportedContext?: ContextRecord; boundary?: DeliveryBoundary; reportedAt?: string | undefined; reportedBoundaryPayload?: ReportedBoundaryDigest | undefined; receivedAt?: string; ingress?: RequestTrace; observedCut?: CapsuleCut; cutComparison?: DeliveryCutComparison}): DeliveryReceipt {
        return new DeliveryReceipt(
            'id' in overrides ? overrides.id! : this._id,
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'owner' in overrides ? overrides.owner! : this._owner,
            'scope' in overrides ? overrides.scope! : this._scope,
            'capsuleId' in overrides ? overrides.capsuleId! : this._capsuleId,
            'capsulePayloadDigest' in overrides ? overrides.capsulePayloadDigest! : this._capsulePayloadDigest,
            'workContext' in overrides ? overrides.workContext! : this._workContext,
            'reportedContext' in overrides ? overrides.reportedContext! : this._reportedContext,
            'boundary' in overrides ? overrides.boundary! : this._boundary,
            'reportedAt' in overrides ? overrides.reportedAt! : this._reportedAt,
            'reportedBoundaryPayload' in overrides ? overrides.reportedBoundaryPayload! : this._reportedBoundaryPayload,
            'receivedAt' in overrides ? overrides.receivedAt! : this._receivedAt,
            'ingress' in overrides ? overrides.ingress! : this._ingress,
            'observedCut' in overrides ? overrides.observedCut! : this._observedCut,
            'cutComparison' in overrides ? overrides.cutComparison! : this._cutComparison
        );
    }

    public static fromPlain(obj: {id: string; requestId: string; owner: Actor; scope: string; capsuleId: string; capsulePayloadDigest: string; workContext: string; reportedContext: ContextRecord; boundary: DeliveryBoundary; reportedAt: string | undefined; reportedBoundaryPayload: ReportedBoundaryDigest | undefined; receivedAt: string; ingress: RequestTrace; observedCut: CapsuleCut; cutComparison: DeliveryCutComparison}): DeliveryReceipt {
        return new DeliveryReceipt(
            obj.id,
            obj.requestId,
            obj.owner,
            obj.scope,
            obj.capsuleId,
            obj.capsulePayloadDigest,
            obj.workContext,
            obj.reportedContext,
            obj.boundary,
            obj.reportedAt,
            obj.reportedBoundaryPayload,
            obj.receivedAt,
            obj.ingress,
            obj.observedCut,
            obj.cutComparison
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return DeliveryReceipt.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return DeliveryReceipt.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#DeliveryReceipt'
    public baboonTypeIdentifier() {
        return DeliveryReceipt.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return DeliveryReceipt.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return DeliveryReceipt.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return DeliveryReceipt.BaboonMinReaderVersions
    }
    public static jsonCodec(): DeliveryReceipt_JsonCodec {
        return DeliveryReceipt_JsonCodec.instance
    }
}

export class DeliveryReceipt_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: DeliveryReceipt): unknown {
        if (this !== DeliveryReceipt_JsonCodec.lazyInstance.value) {
          return DeliveryReceipt_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "requestId": value.requestId,
            "owner": Actor_JsonCodec.instance.encode(BaboonCodecContext.Default, value.owner),
            "scope": value.scope,
            "capsuleId": value.capsuleId,
            "capsulePayloadDigest": value.capsulePayloadDigest,
            "workContext": value.workContext,
            "reportedContext": ContextRecord_JsonCodec.instance.encode(BaboonCodecContext.Default, value.reportedContext),
            "boundary": DeliveryBoundary_JsonCodec.instance.encode(BaboonCodecContext.Default, value.boundary),
            "reportedAt": value.reportedAt === undefined ? null : value.reportedAt,
            "reportedBoundaryPayload": value.reportedBoundaryPayload === undefined ? null : ReportedBoundaryDigest_JsonCodec.instance.encode(BaboonCodecContext.Default, value.reportedBoundaryPayload),
            "receivedAt": value.receivedAt,
            "ingress": RequestTrace_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ingress),
            "observedCut": CapsuleCut_JsonCodec.instance.encode(BaboonCodecContext.Default, value.observedCut),
            "cutComparison": DeliveryCutComparison_JsonCodec.instance.encode(BaboonCodecContext.Default, value.cutComparison),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): DeliveryReceipt {
        if (this !== DeliveryReceipt_JsonCodec .lazyInstance.value) {
            return DeliveryReceipt_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new DeliveryReceipt (
            obj["id"] as string,
            obj["requestId"] as string,
            Actor_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["owner"]),
            obj["scope"] as string,
            obj["capsuleId"] as string,
            obj["capsulePayloadDigest"] as string,
            obj["workContext"] as string,
            ContextRecord_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["reportedContext"]),
            DeliveryBoundary_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["boundary"]),
            obj["reportedAt"] === undefined || obj["reportedAt"] === null ? undefined : obj["reportedAt"] === undefined || obj["reportedAt"] === null ? undefined : obj["reportedAt"] as string,
            obj["reportedBoundaryPayload"] === undefined || obj["reportedBoundaryPayload"] === null ? undefined : obj["reportedBoundaryPayload"] === undefined || obj["reportedBoundaryPayload"] === null ? undefined : ReportedBoundaryDigest_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["reportedBoundaryPayload"]),
            obj["receivedAt"] as string,
            RequestTrace_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ingress"]),
            CapsuleCut_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["observedCut"]),
            DeliveryCutComparison_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["cutComparison"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return DeliveryReceipt_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return DeliveryReceipt_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#DeliveryReceipt'
    public baboonTypeIdentifier() {
        return DeliveryReceipt_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new DeliveryReceipt_JsonCodec())
    public static get instance(): DeliveryReceipt_JsonCodec {
        return DeliveryReceipt_JsonCodec.lazyInstance.value
    }
}