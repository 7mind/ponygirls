import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Actor, Actor_JsonCodec} from './Actor.js'
import {PresentationPayload, PresentationPayload_JsonCodec} from './PresentationPayload.js'
import {Ref, Ref_JsonCodec} from './Ref.js'
import {RequestTrace, RequestTrace_JsonCodec} from './RequestTrace.js'

export class Presentation implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _owner: Actor;
    private readonly _reservedSourceRef: Ref;
    private readonly _payload: PresentationPayload;
    private readonly _payloadDigest: string;
    private readonly _createdAt: string;
    private readonly _preparationTrace: RequestTrace;

    constructor(id: string, owner: Actor, reservedSourceRef: Ref, payload: PresentationPayload, payloadDigest: string, createdAt: string, preparationTrace: RequestTrace) {
        this._id = id
        this._owner = owner
        this._reservedSourceRef = reservedSourceRef
        this._payload = payload
        this._payloadDigest = payloadDigest
        this._createdAt = createdAt
        this._preparationTrace = preparationTrace
    }

    public get id(): string {
        return this._id;
    }
    public get owner(): Actor {
        return this._owner;
    }
    public get reservedSourceRef(): Ref {
        return this._reservedSourceRef;
    }
    public get payload(): PresentationPayload {
        return this._payload;
    }
    public get payloadDigest(): string {
        return this._payloadDigest;
    }
    public get createdAt(): string {
        return this._createdAt;
    }
    public get preparationTrace(): RequestTrace {
        return this._preparationTrace;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            owner: this._owner,
            reservedSourceRef: this._reservedSourceRef,
            payload: this._payload,
            payloadDigest: this._payloadDigest,
            createdAt: this._createdAt,
            preparationTrace: this._preparationTrace
        };
    }

    public with(overrides: {id?: string; owner?: Actor; reservedSourceRef?: Ref; payload?: PresentationPayload; payloadDigest?: string; createdAt?: string; preparationTrace?: RequestTrace}): Presentation {
        return new Presentation(
            'id' in overrides ? overrides.id! : this._id,
            'owner' in overrides ? overrides.owner! : this._owner,
            'reservedSourceRef' in overrides ? overrides.reservedSourceRef! : this._reservedSourceRef,
            'payload' in overrides ? overrides.payload! : this._payload,
            'payloadDigest' in overrides ? overrides.payloadDigest! : this._payloadDigest,
            'createdAt' in overrides ? overrides.createdAt! : this._createdAt,
            'preparationTrace' in overrides ? overrides.preparationTrace! : this._preparationTrace
        );
    }

    public static fromPlain(obj: {id: string; owner: Actor; reservedSourceRef: Ref; payload: PresentationPayload; payloadDigest: string; createdAt: string; preparationTrace: RequestTrace}): Presentation {
        return new Presentation(
            obj.id,
            obj.owner,
            obj.reservedSourceRef,
            obj.payload,
            obj.payloadDigest,
            obj.createdAt,
            obj.preparationTrace
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Presentation.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Presentation.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Presentation'
    public baboonTypeIdentifier() {
        return Presentation.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Presentation.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Presentation.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Presentation.BaboonMinReaderVersions
    }
    public static jsonCodec(): Presentation_JsonCodec {
        return Presentation_JsonCodec.instance
    }
}

export class Presentation_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Presentation): unknown {
        if (this !== Presentation_JsonCodec.lazyInstance.value) {
          return Presentation_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "owner": Actor_JsonCodec.instance.encode(BaboonCodecContext.Default, value.owner),
            "reservedSourceRef": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.reservedSourceRef),
            "payload": PresentationPayload_JsonCodec.instance.encode(BaboonCodecContext.Default, value.payload),
            "payloadDigest": value.payloadDigest,
            "createdAt": value.createdAt,
            "preparationTrace": RequestTrace_JsonCodec.instance.encode(BaboonCodecContext.Default, value.preparationTrace),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Presentation {
        if (this !== Presentation_JsonCodec .lazyInstance.value) {
            return Presentation_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Presentation (
            obj["id"] as string,
            Actor_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["owner"]),
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["reservedSourceRef"]),
            PresentationPayload_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["payload"]),
            obj["payloadDigest"] as string,
            obj["createdAt"] as string,
            RequestTrace_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["preparationTrace"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Presentation_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Presentation_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Presentation'
    public baboonTypeIdentifier() {
        return Presentation_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Presentation_JsonCodec())
    public static get instance(): Presentation_JsonCodec {
        return Presentation_JsonCodec.lazyInstance.value
    }
}