import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {CaptureContext, CaptureContext_JsonCodec} from './CaptureContext.js'

export class DeliveryRequest implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _requestId: string;
    private readonly _capsuleId: string;
    private readonly _generation: bigint;
    private readonly _frontier: bigint;
    private readonly _context: CaptureContext;
    private readonly _payloadDigest: string;

    constructor(scope: string, requestId: string, capsuleId: string, generation: bigint, frontier: bigint, context: CaptureContext, payloadDigest: string) {
        this._scope = scope
        this._requestId = requestId
        this._capsuleId = capsuleId
        this._generation = generation
        this._frontier = frontier
        this._context = context
        this._payloadDigest = payloadDigest
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
    public get generation(): bigint {
        return this._generation;
    }
    public get frontier(): bigint {
        return this._frontier;
    }
    public get context(): CaptureContext {
        return this._context;
    }
    public get payloadDigest(): string {
        return this._payloadDigest;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            requestId: this._requestId,
            capsuleId: this._capsuleId,
            generation: this._generation,
            frontier: this._frontier,
            context: this._context,
            payloadDigest: this._payloadDigest
        };
    }

    public with(overrides: {scope?: string; requestId?: string; capsuleId?: string; generation?: bigint; frontier?: bigint; context?: CaptureContext; payloadDigest?: string}): DeliveryRequest {
        return new DeliveryRequest(
            'scope' in overrides ? overrides.scope! : this._scope,
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'capsuleId' in overrides ? overrides.capsuleId! : this._capsuleId,
            'generation' in overrides ? overrides.generation! : this._generation,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'context' in overrides ? overrides.context! : this._context,
            'payloadDigest' in overrides ? overrides.payloadDigest! : this._payloadDigest
        );
    }

    public static fromPlain(obj: {scope: string; requestId: string; capsuleId: string; generation: bigint; frontier: bigint; context: CaptureContext; payloadDigest: string}): DeliveryRequest {
        return new DeliveryRequest(
            obj.scope,
            obj.requestId,
            obj.capsuleId,
            obj.generation,
            obj.frontier,
            obj.context,
            obj.payloadDigest
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
            "generation": value.generation.toString(),
            "frontier": value.frontier.toString(),
            "context": CaptureContext_JsonCodec.instance.encode(BaboonCodecContext.Default, value.context),
            "payloadDigest": value.payloadDigest,
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
            BaboonInt64.read(obj["generation"], "i64/u64"),
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            CaptureContext_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["context"]),
            obj["payloadDigest"] as string,
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