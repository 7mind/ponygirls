import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'

export class ActivityClassQueue implements BaboonGeneratedLatest {
    private readonly _queued: bigint;
    private readonly _claimable: bigint;
    private readonly _held: bigint;
    private readonly _awaitingReclaim: bigint;
    private readonly _oldestWaitingSince: string | undefined;

    constructor(queued: bigint, claimable: bigint, held: bigint, awaitingReclaim: bigint, oldestWaitingSince: string | undefined) {
        this._queued = queued
        this._claimable = claimable
        this._held = held
        this._awaitingReclaim = awaitingReclaim
        this._oldestWaitingSince = oldestWaitingSince
    }

    public get queued(): bigint {
        return this._queued;
    }
    public get claimable(): bigint {
        return this._claimable;
    }
    public get held(): bigint {
        return this._held;
    }
    public get awaitingReclaim(): bigint {
        return this._awaitingReclaim;
    }
    public get oldestWaitingSince(): string | undefined {
        return this._oldestWaitingSince;
    }

    public toJSON(): Record<string, unknown> {
        return {
            queued: this._queued,
            claimable: this._claimable,
            held: this._held,
            awaitingReclaim: this._awaitingReclaim,
            oldestWaitingSince: this._oldestWaitingSince !== undefined ? this._oldestWaitingSince : undefined
        };
    }

    public with(overrides: {queued?: bigint; claimable?: bigint; held?: bigint; awaitingReclaim?: bigint; oldestWaitingSince?: string | undefined}): ActivityClassQueue {
        return new ActivityClassQueue(
            'queued' in overrides ? overrides.queued! : this._queued,
            'claimable' in overrides ? overrides.claimable! : this._claimable,
            'held' in overrides ? overrides.held! : this._held,
            'awaitingReclaim' in overrides ? overrides.awaitingReclaim! : this._awaitingReclaim,
            'oldestWaitingSince' in overrides ? overrides.oldestWaitingSince! : this._oldestWaitingSince
        );
    }

    public static fromPlain(obj: {queued: bigint; claimable: bigint; held: bigint; awaitingReclaim: bigint; oldestWaitingSince: string | undefined}): ActivityClassQueue {
        return new ActivityClassQueue(
            obj.queued,
            obj.claimable,
            obj.held,
            obj.awaitingReclaim,
            obj.oldestWaitingSince
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityClassQueue.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityClassQueue.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityClassQueue'
    public baboonTypeIdentifier() {
        return ActivityClassQueue.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityClassQueue.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityClassQueue.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityClassQueue.BaboonMinReaderVersions
    }
    public static jsonCodec(): ActivityClassQueue_JsonCodec {
        return ActivityClassQueue_JsonCodec.instance
    }
}

export class ActivityClassQueue_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityClassQueue): unknown {
        if (this !== ActivityClassQueue_JsonCodec.lazyInstance.value) {
          return ActivityClassQueue_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "queued": value.queued.toString(),
            "claimable": value.claimable.toString(),
            "held": value.held.toString(),
            "awaitingReclaim": value.awaitingReclaim.toString(),
            "oldestWaitingSince": value.oldestWaitingSince === undefined ? null : value.oldestWaitingSince,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityClassQueue {
        if (this !== ActivityClassQueue_JsonCodec .lazyInstance.value) {
            return ActivityClassQueue_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityClassQueue (
            BaboonInt64.read(obj["queued"], "i64/u64"),
            BaboonInt64.read(obj["claimable"], "i64/u64"),
            BaboonInt64.read(obj["held"], "i64/u64"),
            BaboonInt64.read(obj["awaitingReclaim"], "i64/u64"),
            obj["oldestWaitingSince"] === undefined || obj["oldestWaitingSince"] === null ? undefined : obj["oldestWaitingSince"] === undefined || obj["oldestWaitingSince"] === null ? undefined : obj["oldestWaitingSince"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityClassQueue_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityClassQueue_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityClassQueue'
    public baboonTypeIdentifier() {
        return ActivityClassQueue_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityClassQueue_JsonCodec())
    public static get instance(): ActivityClassQueue_JsonCodec {
        return ActivityClassQueue_JsonCodec.lazyInstance.value
    }
}