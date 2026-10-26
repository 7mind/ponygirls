import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../../BaboonSharedRuntime.js'

export class JobCounts implements BaboonGenerated {
    private readonly _total: bigint;
    private readonly _queued: bigint;
    private readonly _running: bigint;
    private readonly _failed: bigint;
    private readonly _complete: bigint;
    private readonly _activeRunning: bigint;
    private readonly _expiredRunning: bigint;
    private readonly _unleasedRunning: bigint;

    constructor(total: bigint, queued: bigint, running: bigint, failed: bigint, complete: bigint, activeRunning: bigint, expiredRunning: bigint, unleasedRunning: bigint) {
        this._total = total
        this._queued = queued
        this._running = running
        this._failed = failed
        this._complete = complete
        this._activeRunning = activeRunning
        this._expiredRunning = expiredRunning
        this._unleasedRunning = unleasedRunning
    }

    public get total(): bigint {
        return this._total;
    }
    public get queued(): bigint {
        return this._queued;
    }
    public get running(): bigint {
        return this._running;
    }
    public get failed(): bigint {
        return this._failed;
    }
    public get complete(): bigint {
        return this._complete;
    }
    public get activeRunning(): bigint {
        return this._activeRunning;
    }
    public get expiredRunning(): bigint {
        return this._expiredRunning;
    }
    public get unleasedRunning(): bigint {
        return this._unleasedRunning;
    }

    public toJSON(): Record<string, unknown> {
        return {
            total: this._total,
            queued: this._queued,
            running: this._running,
            failed: this._failed,
            complete: this._complete,
            activeRunning: this._activeRunning,
            expiredRunning: this._expiredRunning,
            unleasedRunning: this._unleasedRunning
        };
    }

    public with(overrides: {total?: bigint; queued?: bigint; running?: bigint; failed?: bigint; complete?: bigint; activeRunning?: bigint; expiredRunning?: bigint; unleasedRunning?: bigint}): JobCounts {
        return new JobCounts(
            'total' in overrides ? overrides.total! : this._total,
            'queued' in overrides ? overrides.queued! : this._queued,
            'running' in overrides ? overrides.running! : this._running,
            'failed' in overrides ? overrides.failed! : this._failed,
            'complete' in overrides ? overrides.complete! : this._complete,
            'activeRunning' in overrides ? overrides.activeRunning! : this._activeRunning,
            'expiredRunning' in overrides ? overrides.expiredRunning! : this._expiredRunning,
            'unleasedRunning' in overrides ? overrides.unleasedRunning! : this._unleasedRunning
        );
    }

    public static fromPlain(obj: {total: bigint; queued: bigint; running: bigint; failed: bigint; complete: bigint; activeRunning: bigint; expiredRunning: bigint; unleasedRunning: bigint}): JobCounts {
        return new JobCounts(
            obj.total,
            obj.queued,
            obj.running,
            obj.failed,
            obj.complete,
            obj.activeRunning,
            obj.expiredRunning,
            obj.unleasedRunning
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return JobCounts.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return JobCounts.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#JobCounts'
    public baboonTypeIdentifier() {
        return JobCounts.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return JobCounts.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical", "1.4.0": "identical" }
    public baboonForwardReadable() {
        return JobCounts.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return JobCounts.BaboonMinReaderVersions
    }
    public static jsonCodec(): JobCounts_JsonCodec {
        return JobCounts_JsonCodec.instance
    }
}

/** @deprecated Version 1.3.0 is deprecated, you should migrate to 1.4.0 */
export class JobCounts_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: JobCounts): unknown {
        if (this !== JobCounts_JsonCodec.lazyInstance.value) {
          return JobCounts_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "total": value.total.toString(),
            "queued": value.queued.toString(),
            "running": value.running.toString(),
            "failed": value.failed.toString(),
            "complete": value.complete.toString(),
            "activeRunning": value.activeRunning.toString(),
            "expiredRunning": value.expiredRunning.toString(),
            "unleasedRunning": value.unleasedRunning.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): JobCounts {
        if (this !== JobCounts_JsonCodec .lazyInstance.value) {
            return JobCounts_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new JobCounts (
            BaboonInt64.read(obj["total"], "i64/u64"),
            BaboonInt64.read(obj["queued"], "i64/u64"),
            BaboonInt64.read(obj["running"], "i64/u64"),
            BaboonInt64.read(obj["failed"], "i64/u64"),
            BaboonInt64.read(obj["complete"], "i64/u64"),
            BaboonInt64.read(obj["activeRunning"], "i64/u64"),
            BaboonInt64.read(obj["expiredRunning"], "i64/u64"),
            BaboonInt64.read(obj["unleasedRunning"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return JobCounts_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return JobCounts_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#JobCounts'
    public baboonTypeIdentifier() {
        return JobCounts_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new JobCounts_JsonCodec())
    public static get instance(): JobCounts_JsonCodec {
        return JobCounts_JsonCodec.lazyInstance.value
    }
}