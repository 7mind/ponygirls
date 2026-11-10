import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'

export class DeliveryReceipt implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _capsuleId: string;
    private readonly _generation: bigint;
    private readonly _frontier: bigint;
    private readonly _payloadDigest: string;
    private readonly _recordedAt: string;

    constructor(id: string, capsuleId: string, generation: bigint, frontier: bigint, payloadDigest: string, recordedAt: string) {
        this._id = id
        this._capsuleId = capsuleId
        this._generation = generation
        this._frontier = frontier
        this._payloadDigest = payloadDigest
        this._recordedAt = recordedAt
    }

    public get id(): string {
        return this._id;
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
    public get payloadDigest(): string {
        return this._payloadDigest;
    }
    public get recordedAt(): string {
        return this._recordedAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            capsuleId: this._capsuleId,
            generation: this._generation,
            frontier: this._frontier,
            payloadDigest: this._payloadDigest,
            recordedAt: this._recordedAt
        };
    }

    public with(overrides: {id?: string; capsuleId?: string; generation?: bigint; frontier?: bigint; payloadDigest?: string; recordedAt?: string}): DeliveryReceipt {
        return new DeliveryReceipt(
            'id' in overrides ? overrides.id! : this._id,
            'capsuleId' in overrides ? overrides.capsuleId! : this._capsuleId,
            'generation' in overrides ? overrides.generation! : this._generation,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'payloadDigest' in overrides ? overrides.payloadDigest! : this._payloadDigest,
            'recordedAt' in overrides ? overrides.recordedAt! : this._recordedAt
        );
    }

    public static fromPlain(obj: {id: string; capsuleId: string; generation: bigint; frontier: bigint; payloadDigest: string; recordedAt: string}): DeliveryReceipt {
        return new DeliveryReceipt(
            obj.id,
            obj.capsuleId,
            obj.generation,
            obj.frontier,
            obj.payloadDigest,
            obj.recordedAt
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
            "capsuleId": value.capsuleId,
            "generation": value.generation.toString(),
            "frontier": value.frontier.toString(),
            "payloadDigest": value.payloadDigest,
            "recordedAt": value.recordedAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): DeliveryReceipt {
        if (this !== DeliveryReceipt_JsonCodec .lazyInstance.value) {
            return DeliveryReceipt_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new DeliveryReceipt (
            obj["id"] as string,
            obj["capsuleId"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            obj["payloadDigest"] as string,
            obj["recordedAt"] as string,
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