import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {ContextRecordInput, ContextRecordInput_JsonCodec} from './ContextRecordInput.js'

export class CapsuleRequest implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _requestId: string;
    private readonly _workContext: string;
    private readonly _reportedContext: ContextRecordInput | undefined;
    private readonly _expectedFrontier: bigint;
    private readonly _previousCapsuleId: string | undefined;

    constructor(scope: string, requestId: string, workContext: string, reportedContext: ContextRecordInput | undefined, expectedFrontier: bigint, previousCapsuleId: string | undefined) {
        this._scope = scope
        this._requestId = requestId
        this._workContext = workContext
        this._reportedContext = reportedContext
        this._expectedFrontier = expectedFrontier
        this._previousCapsuleId = previousCapsuleId
    }

    public get scope(): string {
        return this._scope;
    }
    public get requestId(): string {
        return this._requestId;
    }
    public get workContext(): string {
        return this._workContext;
    }
    public get reportedContext(): ContextRecordInput | undefined {
        return this._reportedContext;
    }
    public get expectedFrontier(): bigint {
        return this._expectedFrontier;
    }
    public get previousCapsuleId(): string | undefined {
        return this._previousCapsuleId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            requestId: this._requestId,
            workContext: this._workContext,
            reportedContext: this._reportedContext !== undefined ? this._reportedContext : undefined,
            expectedFrontier: this._expectedFrontier,
            previousCapsuleId: this._previousCapsuleId !== undefined ? this._previousCapsuleId : undefined
        };
    }

    public with(overrides: {scope?: string; requestId?: string; workContext?: string; reportedContext?: ContextRecordInput | undefined; expectedFrontier?: bigint; previousCapsuleId?: string | undefined}): CapsuleRequest {
        return new CapsuleRequest(
            'scope' in overrides ? overrides.scope! : this._scope,
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'workContext' in overrides ? overrides.workContext! : this._workContext,
            'reportedContext' in overrides ? overrides.reportedContext! : this._reportedContext,
            'expectedFrontier' in overrides ? overrides.expectedFrontier! : this._expectedFrontier,
            'previousCapsuleId' in overrides ? overrides.previousCapsuleId! : this._previousCapsuleId
        );
    }

    public static fromPlain(obj: {scope: string; requestId: string; workContext: string; reportedContext: ContextRecordInput | undefined; expectedFrontier: bigint; previousCapsuleId: string | undefined}): CapsuleRequest {
        return new CapsuleRequest(
            obj.scope,
            obj.requestId,
            obj.workContext,
            obj.reportedContext,
            obj.expectedFrontier,
            obj.previousCapsuleId
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleRequest'
    public baboonTypeIdentifier() {
        return CapsuleRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CapsuleRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CapsuleRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CapsuleRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): CapsuleRequest_JsonCodec {
        return CapsuleRequest_JsonCodec.instance
    }
}

export class CapsuleRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CapsuleRequest): unknown {
        if (this !== CapsuleRequest_JsonCodec.lazyInstance.value) {
          return CapsuleRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "requestId": value.requestId,
            "workContext": value.workContext,
            "reportedContext": value.reportedContext === undefined ? null : ContextRecordInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.reportedContext),
            "expectedFrontier": value.expectedFrontier.toString(),
            "previousCapsuleId": value.previousCapsuleId === undefined ? null : value.previousCapsuleId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CapsuleRequest {
        if (this !== CapsuleRequest_JsonCodec .lazyInstance.value) {
            return CapsuleRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CapsuleRequest (
            obj["scope"] as string,
            obj["requestId"] as string,
            obj["workContext"] as string,
            obj["reportedContext"] === undefined || obj["reportedContext"] === null ? undefined : obj["reportedContext"] === undefined || obj["reportedContext"] === null ? undefined : ContextRecordInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["reportedContext"]),
            BaboonInt64.read(obj["expectedFrontier"], "i64/u64"),
            obj["previousCapsuleId"] === undefined || obj["previousCapsuleId"] === null ? undefined : obj["previousCapsuleId"] === undefined || obj["previousCapsuleId"] === null ? undefined : obj["previousCapsuleId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleRequest'
    public baboonTypeIdentifier() {
        return CapsuleRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CapsuleRequest_JsonCodec())
    public static get instance(): CapsuleRequest_JsonCodec {
        return CapsuleRequest_JsonCodec.lazyInstance.value
    }
}