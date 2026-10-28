import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../../BaboonSharedRuntime.js'
import {ActivityJob, ActivityJob_JsonCodec} from './ActivityJob.js'

export class ActivityJobsResult implements BaboonGenerated {
    private readonly _observedAt: string;
    private readonly _jobs: Array<ActivityJob>;
    private readonly _total: bigint;
    private readonly _nextCursor: string | undefined;

    constructor(observedAt: string, jobs: Array<ActivityJob>, total: bigint, nextCursor: string | undefined) {
        this._observedAt = observedAt
        this._jobs = jobs
        this._total = total
        this._nextCursor = nextCursor
    }

    public get observedAt(): string {
        return this._observedAt;
    }
    public get jobs(): Array<ActivityJob> {
        return this._jobs;
    }
    public get total(): bigint {
        return this._total;
    }
    public get nextCursor(): string | undefined {
        return this._nextCursor;
    }

    public toJSON(): Record<string, unknown> {
        return {
            observedAt: this._observedAt,
            jobs: this._jobs,
            total: this._total,
            nextCursor: this._nextCursor !== undefined ? this._nextCursor : undefined
        };
    }

    public with(overrides: {observedAt?: string; jobs?: Array<ActivityJob>; total?: bigint; nextCursor?: string | undefined}): ActivityJobsResult {
        return new ActivityJobsResult(
            'observedAt' in overrides ? overrides.observedAt! : this._observedAt,
            'jobs' in overrides ? overrides.jobs! : this._jobs,
            'total' in overrides ? overrides.total! : this._total,
            'nextCursor' in overrides ? overrides.nextCursor! : this._nextCursor
        );
    }

    public static fromPlain(obj: {observedAt: string; jobs: Array<ActivityJob>; total: bigint; nextCursor: string | undefined}): ActivityJobsResult {
        return new ActivityJobsResult(
            obj.observedAt,
            obj.jobs,
            obj.total,
            obj.nextCursor
        );
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return ActivityJobsResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobsResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityJobsResult'
    public baboonTypeIdentifier() {
        return ActivityJobsResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0", "1.5.0", "1.6.0"]
    public baboonSameInVersions() {
        return ActivityJobsResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.6.0": "identical", "1.7.0": "json-additive" }
    public baboonForwardReadable() {
        return ActivityJobsResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return ActivityJobsResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): ActivityJobsResult_JsonCodec {
        return ActivityJobsResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.7.0 */
export class ActivityJobsResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobsResult): unknown {
        if (this !== ActivityJobsResult_JsonCodec.lazyInstance.value) {
          return ActivityJobsResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "observedAt": value.observedAt,
            "jobs": Array.from(value.jobs).map(item => ActivityJob_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "total": value.total.toString(),
            "nextCursor": value.nextCursor === undefined ? null : value.nextCursor,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobsResult {
        if (this !== ActivityJobsResult_JsonCodec .lazyInstance.value) {
            return ActivityJobsResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityJobsResult (
            obj["observedAt"] as string,
            (obj["jobs"] as unknown[]).map(item => ActivityJob_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            BaboonInt64.read(obj["total"], "i64/u64"),
            obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return ActivityJobsResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobsResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityJobsResult'
    public baboonTypeIdentifier() {
        return ActivityJobsResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobsResult_JsonCodec())
    public static get instance(): ActivityJobsResult_JsonCodec {
        return ActivityJobsResult_JsonCodec.lazyInstance.value
    }
}