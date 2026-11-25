import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ActivityClaimOrderSort, ActivityClaimOrderSort_JsonCodec} from './ActivityClaimOrderSort.js'
import {ActivityJobsQuery, ActivityJobsQuery_JsonCodec} from './ActivityJobsQuery.js'

export class ActivityClaimOrderJobsQuery implements BaboonGeneratedLatest {
    private readonly _jobs: ActivityJobsQuery;
    private readonly _order: ActivityClaimOrderSort | undefined;

    constructor(jobs: ActivityJobsQuery, order: ActivityClaimOrderSort | undefined) {
        this._jobs = jobs
        this._order = order
    }

    public get jobs(): ActivityJobsQuery {
        return this._jobs;
    }
    public get order(): ActivityClaimOrderSort | undefined {
        return this._order;
    }

    public toJSON(): Record<string, unknown> {
        return {
            jobs: this._jobs,
            order: this._order !== undefined ? this._order : undefined
        };
    }

    public with(overrides: {jobs?: ActivityJobsQuery; order?: ActivityClaimOrderSort | undefined}): ActivityClaimOrderJobsQuery {
        return new ActivityClaimOrderJobsQuery(
            'jobs' in overrides ? overrides.jobs! : this._jobs,
            'order' in overrides ? overrides.order! : this._order
        );
    }

    public static fromPlain(obj: {jobs: ActivityJobsQuery; order: ActivityClaimOrderSort | undefined}): ActivityClaimOrderJobsQuery {
        return new ActivityClaimOrderJobsQuery(
            obj.jobs,
            obj.order
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityClaimOrderJobsQuery.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityClaimOrderJobsQuery.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityClaimOrderJobsQuery'
    public baboonTypeIdentifier() {
        return ActivityClaimOrderJobsQuery.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityClaimOrderJobsQuery.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityClaimOrderJobsQuery.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityClaimOrderJobsQuery.BaboonMinReaderVersions
    }
    public static jsonCodec(): ActivityClaimOrderJobsQuery_JsonCodec {
        return ActivityClaimOrderJobsQuery_JsonCodec.instance
    }
}

export class ActivityClaimOrderJobsQuery_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityClaimOrderJobsQuery): unknown {
        if (this !== ActivityClaimOrderJobsQuery_JsonCodec.lazyInstance.value) {
          return ActivityClaimOrderJobsQuery_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "jobs": ActivityJobsQuery_JsonCodec.instance.encode(BaboonCodecContext.Default, value.jobs),
            "order": value.order === undefined ? null : ActivityClaimOrderSort_JsonCodec.instance.encode(BaboonCodecContext.Default, value.order),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityClaimOrderJobsQuery {
        if (this !== ActivityClaimOrderJobsQuery_JsonCodec .lazyInstance.value) {
            return ActivityClaimOrderJobsQuery_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityClaimOrderJobsQuery (
            ActivityJobsQuery_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["jobs"]),
            obj["order"] === undefined || obj["order"] === null ? undefined : obj["order"] === undefined || obj["order"] === null ? undefined : ActivityClaimOrderSort_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["order"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityClaimOrderJobsQuery_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityClaimOrderJobsQuery_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityClaimOrderJobsQuery'
    public baboonTypeIdentifier() {
        return ActivityClaimOrderJobsQuery_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityClaimOrderJobsQuery_JsonCodec())
    public static get instance(): ActivityClaimOrderJobsQuery_JsonCodec {
        return ActivityClaimOrderJobsQuery_JsonCodec.lazyInstance.value
    }
}