import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ContextRecordInput, ContextRecordInput_JsonCodec} from './ContextRecordInput.js'
import {DeliveryBoundary, DeliveryBoundary_JsonCodec} from './DeliveryBoundary.js'
import {ReportedBoundaryDigest, ReportedBoundaryDigest_JsonCodec} from './ReportedBoundaryDigest.js'

export class DeliveryRequest implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _requestId: string;
    private readonly _capsuleId: string;
    private readonly _capsulePayloadDigest: string;
    private readonly _workContext: string;
    private readonly _reportedContext: ContextRecordInput | undefined;
    private readonly _boundary: DeliveryBoundary;
    private readonly _reportedAt: string | undefined;
    private readonly _reportedBoundaryPayload: ReportedBoundaryDigest | undefined;

    constructor(scope: string, requestId: string, capsuleId: string, capsulePayloadDigest: string, workContext: string, reportedContext: ContextRecordInput | undefined, boundary: DeliveryBoundary, reportedAt: string | undefined, reportedBoundaryPayload: ReportedBoundaryDigest | undefined) {
        this._scope = scope
        this._requestId = requestId
        this._capsuleId = capsuleId
        this._capsulePayloadDigest = capsulePayloadDigest
        this._workContext = workContext
        this._reportedContext = reportedContext
        this._boundary = boundary
        this._reportedAt = reportedAt
        this._reportedBoundaryPayload = reportedBoundaryPayload
    }

    public get scope(): string {
        return this._scope;
    }
    public get requestId(): string {
        return this._requestId;
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
    public get reportedContext(): ContextRecordInput | undefined {
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

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            requestId: this._requestId,
            capsuleId: this._capsuleId,
            capsulePayloadDigest: this._capsulePayloadDigest,
            workContext: this._workContext,
            reportedContext: this._reportedContext !== undefined ? this._reportedContext : undefined,
            boundary: this._boundary,
            reportedAt: this._reportedAt !== undefined ? this._reportedAt : undefined,
            reportedBoundaryPayload: this._reportedBoundaryPayload !== undefined ? this._reportedBoundaryPayload : undefined
        };
    }

    public with(overrides: {scope?: string; requestId?: string; capsuleId?: string; capsulePayloadDigest?: string; workContext?: string; reportedContext?: ContextRecordInput | undefined; boundary?: DeliveryBoundary; reportedAt?: string | undefined; reportedBoundaryPayload?: ReportedBoundaryDigest | undefined}): DeliveryRequest {
        return new DeliveryRequest(
            'scope' in overrides ? overrides.scope! : this._scope,
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'capsuleId' in overrides ? overrides.capsuleId! : this._capsuleId,
            'capsulePayloadDigest' in overrides ? overrides.capsulePayloadDigest! : this._capsulePayloadDigest,
            'workContext' in overrides ? overrides.workContext! : this._workContext,
            'reportedContext' in overrides ? overrides.reportedContext! : this._reportedContext,
            'boundary' in overrides ? overrides.boundary! : this._boundary,
            'reportedAt' in overrides ? overrides.reportedAt! : this._reportedAt,
            'reportedBoundaryPayload' in overrides ? overrides.reportedBoundaryPayload! : this._reportedBoundaryPayload
        );
    }

    public static fromPlain(obj: {scope: string; requestId: string; capsuleId: string; capsulePayloadDigest: string; workContext: string; reportedContext: ContextRecordInput | undefined; boundary: DeliveryBoundary; reportedAt: string | undefined; reportedBoundaryPayload: ReportedBoundaryDigest | undefined}): DeliveryRequest {
        return new DeliveryRequest(
            obj.scope,
            obj.requestId,
            obj.capsuleId,
            obj.capsulePayloadDigest,
            obj.workContext,
            obj.reportedContext,
            obj.boundary,
            obj.reportedAt,
            obj.reportedBoundaryPayload
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return DeliveryRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return DeliveryRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#DeliveryRequest'
    public baboonTypeIdentifier() {
        return DeliveryRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return DeliveryRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return DeliveryRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return DeliveryRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): DeliveryRequest_JsonCodec {
        return DeliveryRequest_JsonCodec.instance
    }
}

export class DeliveryRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: DeliveryRequest): unknown {
        if (this !== DeliveryRequest_JsonCodec.lazyInstance.value) {
          return DeliveryRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "requestId": value.requestId,
            "capsuleId": value.capsuleId,
            "capsulePayloadDigest": value.capsulePayloadDigest,
            "workContext": value.workContext,
            "reportedContext": value.reportedContext === undefined ? null : ContextRecordInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.reportedContext),
            "boundary": DeliveryBoundary_JsonCodec.instance.encode(BaboonCodecContext.Default, value.boundary),
            "reportedAt": value.reportedAt === undefined ? null : value.reportedAt,
            "reportedBoundaryPayload": value.reportedBoundaryPayload === undefined ? null : ReportedBoundaryDigest_JsonCodec.instance.encode(BaboonCodecContext.Default, value.reportedBoundaryPayload),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): DeliveryRequest {
        if (this !== DeliveryRequest_JsonCodec .lazyInstance.value) {
            return DeliveryRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new DeliveryRequest (
            obj["scope"] as string,
            obj["requestId"] as string,
            obj["capsuleId"] as string,
            obj["capsulePayloadDigest"] as string,
            obj["workContext"] as string,
            obj["reportedContext"] === undefined || obj["reportedContext"] === null ? undefined : obj["reportedContext"] === undefined || obj["reportedContext"] === null ? undefined : ContextRecordInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["reportedContext"]),
            DeliveryBoundary_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["boundary"]),
            obj["reportedAt"] === undefined || obj["reportedAt"] === null ? undefined : obj["reportedAt"] === undefined || obj["reportedAt"] === null ? undefined : obj["reportedAt"] as string,
            obj["reportedBoundaryPayload"] === undefined || obj["reportedBoundaryPayload"] === null ? undefined : obj["reportedBoundaryPayload"] === undefined || obj["reportedBoundaryPayload"] === null ? undefined : ReportedBoundaryDigest_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["reportedBoundaryPayload"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return DeliveryRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return DeliveryRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#DeliveryRequest'
    public baboonTypeIdentifier() {
        return DeliveryRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new DeliveryRequest_JsonCodec())
    public static get instance(): DeliveryRequest_JsonCodec {
        return DeliveryRequest_JsonCodec.lazyInstance.value
    }
}