import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Actor, Actor_JsonCodec} from './Actor.js'
import {CapsuleLimits, CapsuleLimits_JsonCodec} from './CapsuleLimits.js'
import {CapsulePayload, CapsulePayload_JsonCodec} from './CapsulePayload.js'
import {RequestTrace, RequestTrace_JsonCodec} from './RequestTrace.js'

export class Capsule implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _requestId: string;
    private readonly _owner: Actor;
    private readonly _payload: CapsulePayload;
    private readonly _payloadDigest: string;
    private readonly _limits: CapsuleLimits;
    private readonly _preparedAt: string;
    private readonly _preparationTrace: RequestTrace;

    constructor(id: string, requestId: string, owner: Actor, payload: CapsulePayload, payloadDigest: string, limits: CapsuleLimits, preparedAt: string, preparationTrace: RequestTrace) {
        this._id = id
        this._requestId = requestId
        this._owner = owner
        this._payload = payload
        this._payloadDigest = payloadDigest
        this._limits = limits
        this._preparedAt = preparedAt
        this._preparationTrace = preparationTrace
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
    public get payload(): CapsulePayload {
        return this._payload;
    }
    public get payloadDigest(): string {
        return this._payloadDigest;
    }
    public get limits(): CapsuleLimits {
        return this._limits;
    }
    public get preparedAt(): string {
        return this._preparedAt;
    }
    public get preparationTrace(): RequestTrace {
        return this._preparationTrace;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            requestId: this._requestId,
            owner: this._owner,
            payload: this._payload,
            payloadDigest: this._payloadDigest,
            limits: this._limits,
            preparedAt: this._preparedAt,
            preparationTrace: this._preparationTrace
        };
    }

    public with(overrides: {id?: string; requestId?: string; owner?: Actor; payload?: CapsulePayload; payloadDigest?: string; limits?: CapsuleLimits; preparedAt?: string; preparationTrace?: RequestTrace}): Capsule {
        return new Capsule(
            'id' in overrides ? overrides.id! : this._id,
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'owner' in overrides ? overrides.owner! : this._owner,
            'payload' in overrides ? overrides.payload! : this._payload,
            'payloadDigest' in overrides ? overrides.payloadDigest! : this._payloadDigest,
            'limits' in overrides ? overrides.limits! : this._limits,
            'preparedAt' in overrides ? overrides.preparedAt! : this._preparedAt,
            'preparationTrace' in overrides ? overrides.preparationTrace! : this._preparationTrace
        );
    }

    public static fromPlain(obj: {id: string; requestId: string; owner: Actor; payload: CapsulePayload; payloadDigest: string; limits: CapsuleLimits; preparedAt: string; preparationTrace: RequestTrace}): Capsule {
        return new Capsule(
            obj.id,
            obj.requestId,
            obj.owner,
            obj.payload,
            obj.payloadDigest,
            obj.limits,
            obj.preparedAt,
            obj.preparationTrace
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Capsule.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Capsule.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Capsule'
    public baboonTypeIdentifier() {
        return Capsule.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Capsule.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Capsule.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Capsule.BaboonMinReaderVersions
    }
    public static jsonCodec(): Capsule_JsonCodec {
        return Capsule_JsonCodec.instance
    }
}

export class Capsule_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Capsule): unknown {
        if (this !== Capsule_JsonCodec.lazyInstance.value) {
          return Capsule_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "requestId": value.requestId,
            "owner": Actor_JsonCodec.instance.encode(BaboonCodecContext.Default, value.owner),
            "payload": CapsulePayload_JsonCodec.instance.encode(BaboonCodecContext.Default, value.payload),
            "payloadDigest": value.payloadDigest,
            "limits": CapsuleLimits_JsonCodec.instance.encode(BaboonCodecContext.Default, value.limits),
            "preparedAt": value.preparedAt,
            "preparationTrace": RequestTrace_JsonCodec.instance.encode(BaboonCodecContext.Default, value.preparationTrace),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Capsule {
        if (this !== Capsule_JsonCodec .lazyInstance.value) {
            return Capsule_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Capsule (
            obj["id"] as string,
            obj["requestId"] as string,
            Actor_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["owner"]),
            CapsulePayload_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["payload"]),
            obj["payloadDigest"] as string,
            CapsuleLimits_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["limits"]),
            obj["preparedAt"] as string,
            RequestTrace_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["preparationTrace"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Capsule_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Capsule_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Capsule'
    public baboonTypeIdentifier() {
        return Capsule_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Capsule_JsonCodec())
    public static get instance(): Capsule_JsonCodec {
        return Capsule_JsonCodec.lazyInstance.value
    }
}