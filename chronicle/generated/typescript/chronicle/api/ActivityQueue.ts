import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {ActivityClaimOrder, ActivityClaimOrder_JsonCodec} from './ActivityClaimOrder.js'
import {ActivityClassQueue, ActivityClassQueue_JsonCodec} from './ActivityClassQueue.js'

export class ActivityQueue implements BaboonGeneratedLatest {
    private readonly _claimOrder: ActivityClaimOrder;
    private readonly _fresh: ActivityClassQueue;
    private readonly _bulk: ActivityClassQueue;
    private readonly _unclassified: ActivityClassQueue;
    private readonly _awaitingLarge: bigint;
    private readonly _largeAhead: bigint | undefined;

    constructor(claimOrder: ActivityClaimOrder, fresh: ActivityClassQueue, bulk: ActivityClassQueue, unclassified: ActivityClassQueue, awaitingLarge: bigint, largeAhead: bigint | undefined) {
        this._claimOrder = claimOrder
        this._fresh = fresh
        this._bulk = bulk
        this._unclassified = unclassified
        this._awaitingLarge = awaitingLarge
        this._largeAhead = largeAhead
    }

    public get claimOrder(): ActivityClaimOrder {
        return this._claimOrder;
    }
    public get fresh(): ActivityClassQueue {
        return this._fresh;
    }
    public get bulk(): ActivityClassQueue {
        return this._bulk;
    }
    public get unclassified(): ActivityClassQueue {
        return this._unclassified;
    }
    public get awaitingLarge(): bigint {
        return this._awaitingLarge;
    }
    public get largeAhead(): bigint | undefined {
        return this._largeAhead;
    }

    public toJSON(): Record<string, unknown> {
        return {
            claimOrder: this._claimOrder,
            fresh: this._fresh,
            bulk: this._bulk,
            unclassified: this._unclassified,
            awaitingLarge: this._awaitingLarge,
            largeAhead: this._largeAhead !== undefined ? this._largeAhead : undefined
        };
    }

    public with(overrides: {claimOrder?: ActivityClaimOrder; fresh?: ActivityClassQueue; bulk?: ActivityClassQueue; unclassified?: ActivityClassQueue; awaitingLarge?: bigint; largeAhead?: bigint | undefined}): ActivityQueue {
        return new ActivityQueue(
            'claimOrder' in overrides ? overrides.claimOrder! : this._claimOrder,
            'fresh' in overrides ? overrides.fresh! : this._fresh,
            'bulk' in overrides ? overrides.bulk! : this._bulk,
            'unclassified' in overrides ? overrides.unclassified! : this._unclassified,
            'awaitingLarge' in overrides ? overrides.awaitingLarge! : this._awaitingLarge,
            'largeAhead' in overrides ? overrides.largeAhead! : this._largeAhead
        );
    }

    public static fromPlain(obj: {claimOrder: ActivityClaimOrder; fresh: ActivityClassQueue; bulk: ActivityClassQueue; unclassified: ActivityClassQueue; awaitingLarge: bigint; largeAhead: bigint | undefined}): ActivityQueue {
        return new ActivityQueue(
            obj.claimOrder,
            obj.fresh,
            obj.bulk,
            obj.unclassified,
            obj.awaitingLarge,
            obj.largeAhead
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityQueue.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityQueue.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityQueue'
    public baboonTypeIdentifier() {
        return ActivityQueue.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityQueue.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityQueue.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityQueue.BaboonMinReaderVersions
    }
    public static jsonCodec(): ActivityQueue_JsonCodec {
        return ActivityQueue_JsonCodec.instance
    }
}

export class ActivityQueue_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityQueue): unknown {
        if (this !== ActivityQueue_JsonCodec.lazyInstance.value) {
          return ActivityQueue_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "claimOrder": ActivityClaimOrder_JsonCodec.instance.encode(BaboonCodecContext.Default, value.claimOrder),
            "fresh": ActivityClassQueue_JsonCodec.instance.encode(BaboonCodecContext.Default, value.fresh),
            "bulk": ActivityClassQueue_JsonCodec.instance.encode(BaboonCodecContext.Default, value.bulk),
            "unclassified": ActivityClassQueue_JsonCodec.instance.encode(BaboonCodecContext.Default, value.unclassified),
            "awaitingLarge": value.awaitingLarge.toString(),
            "largeAhead": value.largeAhead === undefined ? null : value.largeAhead.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityQueue {
        if (this !== ActivityQueue_JsonCodec .lazyInstance.value) {
            return ActivityQueue_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityQueue (
            ActivityClaimOrder_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["claimOrder"]),
            ActivityClassQueue_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["fresh"]),
            ActivityClassQueue_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["bulk"]),
            ActivityClassQueue_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["unclassified"]),
            BaboonInt64.read(obj["awaitingLarge"], "i64/u64"),
            obj["largeAhead"] === undefined || obj["largeAhead"] === null ? undefined : obj["largeAhead"] === undefined || obj["largeAhead"] === null ? undefined : BaboonInt64.read(obj["largeAhead"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityQueue_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityQueue_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityQueue'
    public baboonTypeIdentifier() {
        return ActivityQueue_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityQueue_JsonCodec())
    public static get instance(): ActivityQueue_JsonCodec {
        return ActivityQueue_JsonCodec.lazyInstance.value
    }
}