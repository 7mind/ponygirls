import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {ContextRecordInput, ContextRecordInput_JsonCodec} from './ContextRecordInput.js'
import {Operation, Operation_JsonCodec} from './Operation.js'

export class ApplyRequest implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _requestId: string;
    private readonly _expectedGeneration: bigint;
    private readonly _operations: Array<Operation>;
    private readonly _contributionContext: ContextRecordInput | undefined;

    constructor(scope: string, requestId: string, expectedGeneration: bigint, operations: Array<Operation>, contributionContext: ContextRecordInput | undefined) {
        this._scope = scope
        this._requestId = requestId
        this._expectedGeneration = expectedGeneration
        this._operations = operations
        this._contributionContext = contributionContext
    }

    public get scope(): string {
        return this._scope;
    }
    public get requestId(): string {
        return this._requestId;
    }
    public get expectedGeneration(): bigint {
        return this._expectedGeneration;
    }
    public get operations(): Array<Operation> {
        return this._operations;
    }
    public get contributionContext(): ContextRecordInput | undefined {
        return this._contributionContext;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            requestId: this._requestId,
            expectedGeneration: this._expectedGeneration,
            operations: this._operations,
            contributionContext: this._contributionContext !== undefined ? this._contributionContext : undefined
        };
    }

    public with(overrides: {scope?: string; requestId?: string; expectedGeneration?: bigint; operations?: Array<Operation>; contributionContext?: ContextRecordInput | undefined}): ApplyRequest {
        return new ApplyRequest(
            'scope' in overrides ? overrides.scope! : this._scope,
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'expectedGeneration' in overrides ? overrides.expectedGeneration! : this._expectedGeneration,
            'operations' in overrides ? overrides.operations! : this._operations,
            'contributionContext' in overrides ? overrides.contributionContext! : this._contributionContext
        );
    }

    public static fromPlain(obj: {scope: string; requestId: string; expectedGeneration: bigint; operations: Array<Operation>; contributionContext: ContextRecordInput | undefined}): ApplyRequest {
        return new ApplyRequest(
            obj.scope,
            obj.requestId,
            obj.expectedGeneration,
            obj.operations,
            obj.contributionContext
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplyRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplyRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ApplyRequest'
    public baboonTypeIdentifier() {
        return ApplyRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ApplyRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ApplyRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ApplyRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): ApplyRequest_JsonCodec {
        return ApplyRequest_JsonCodec.instance
    }
}

export class ApplyRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ApplyRequest): unknown {
        if (this !== ApplyRequest_JsonCodec.lazyInstance.value) {
          return ApplyRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "requestId": value.requestId,
            "expectedGeneration": value.expectedGeneration.toString(),
            "operations": Array.from(value.operations).map(item => Operation_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "contributionContext": value.contributionContext === undefined ? null : ContextRecordInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.contributionContext),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ApplyRequest {
        if (this !== ApplyRequest_JsonCodec .lazyInstance.value) {
            return ApplyRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ApplyRequest (
            obj["scope"] as string,
            obj["requestId"] as string,
            BaboonInt64.read(obj["expectedGeneration"], "i64/u64"),
            (obj["operations"] as unknown[]).map(item => Operation_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["contributionContext"] === undefined || obj["contributionContext"] === null ? undefined : obj["contributionContext"] === undefined || obj["contributionContext"] === null ? undefined : ContextRecordInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["contributionContext"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplyRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplyRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ApplyRequest'
    public baboonTypeIdentifier() {
        return ApplyRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ApplyRequest_JsonCodec())
    public static get instance(): ApplyRequest_JsonCodec {
        return ApplyRequest_JsonCodec.lazyInstance.value
    }
}