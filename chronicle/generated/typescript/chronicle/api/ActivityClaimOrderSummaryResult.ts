import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ActivityQueue, ActivityQueue_JsonCodec} from './ActivityQueue.js'

export class ActivityClaimOrderSummaryResult implements BaboonGeneratedLatest {
    private readonly _observedAt: string;
    private readonly _queue: ActivityQueue;

    constructor(observedAt: string, queue: ActivityQueue) {
        this._observedAt = observedAt
        this._queue = queue
    }

    public get observedAt(): string {
        return this._observedAt;
    }
    public get queue(): ActivityQueue {
        return this._queue;
    }

    public toJSON(): Record<string, unknown> {
        return {
            observedAt: this._observedAt,
            queue: this._queue
        };
    }

    public with(overrides: {observedAt?: string; queue?: ActivityQueue}): ActivityClaimOrderSummaryResult {
        return new ActivityClaimOrderSummaryResult(
            'observedAt' in overrides ? overrides.observedAt! : this._observedAt,
            'queue' in overrides ? overrides.queue! : this._queue
        );
    }

    public static fromPlain(obj: {observedAt: string; queue: ActivityQueue}): ActivityClaimOrderSummaryResult {
        return new ActivityClaimOrderSummaryResult(
            obj.observedAt,
            obj.queue
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityClaimOrderSummaryResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityClaimOrderSummaryResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityClaimOrderSummaryResult'
    public baboonTypeIdentifier() {
        return ActivityClaimOrderSummaryResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityClaimOrderSummaryResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityClaimOrderSummaryResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityClaimOrderSummaryResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): ActivityClaimOrderSummaryResult_JsonCodec {
        return ActivityClaimOrderSummaryResult_JsonCodec.instance
    }
}

export class ActivityClaimOrderSummaryResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityClaimOrderSummaryResult): unknown {
        if (this !== ActivityClaimOrderSummaryResult_JsonCodec.lazyInstance.value) {
          return ActivityClaimOrderSummaryResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "observedAt": value.observedAt,
            "queue": ActivityQueue_JsonCodec.instance.encode(BaboonCodecContext.Default, value.queue),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityClaimOrderSummaryResult {
        if (this !== ActivityClaimOrderSummaryResult_JsonCodec .lazyInstance.value) {
            return ActivityClaimOrderSummaryResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityClaimOrderSummaryResult (
            obj["observedAt"] as string,
            ActivityQueue_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["queue"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityClaimOrderSummaryResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityClaimOrderSummaryResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityClaimOrderSummaryResult'
    public baboonTypeIdentifier() {
        return ActivityClaimOrderSummaryResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityClaimOrderSummaryResult_JsonCodec())
    public static get instance(): ActivityClaimOrderSummaryResult_JsonCodec {
        return ActivityClaimOrderSummaryResult_JsonCodec.lazyInstance.value
    }
}