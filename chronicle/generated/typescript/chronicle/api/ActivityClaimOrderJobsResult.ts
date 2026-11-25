import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ActivityClaimOrder, ActivityClaimOrder_JsonCodec} from './ActivityClaimOrder.js'
import {ActivityJobClaimOrder, ActivityJobClaimOrder_JsonCodec} from './ActivityJobClaimOrder.js'
import {ActivityJobsResult, ActivityJobsResult_JsonCodec} from './ActivityJobsResult.js'

export class ActivityClaimOrderJobsResult implements BaboonGeneratedLatest {
    private readonly _page: ActivityJobsResult;
    private readonly _claimOrder: ActivityClaimOrder;
    private readonly _jobs: Array<ActivityJobClaimOrder>;

    constructor(page: ActivityJobsResult, claimOrder: ActivityClaimOrder, jobs: Array<ActivityJobClaimOrder>) {
        this._page = page
        this._claimOrder = claimOrder
        this._jobs = jobs
    }

    public get page(): ActivityJobsResult {
        return this._page;
    }
    public get claimOrder(): ActivityClaimOrder {
        return this._claimOrder;
    }
    public get jobs(): Array<ActivityJobClaimOrder> {
        return this._jobs;
    }

    public toJSON(): Record<string, unknown> {
        return {
            page: this._page,
            claimOrder: this._claimOrder,
            jobs: this._jobs
        };
    }

    public with(overrides: {page?: ActivityJobsResult; claimOrder?: ActivityClaimOrder; jobs?: Array<ActivityJobClaimOrder>}): ActivityClaimOrderJobsResult {
        return new ActivityClaimOrderJobsResult(
            'page' in overrides ? overrides.page! : this._page,
            'claimOrder' in overrides ? overrides.claimOrder! : this._claimOrder,
            'jobs' in overrides ? overrides.jobs! : this._jobs
        );
    }

    public static fromPlain(obj: {page: ActivityJobsResult; claimOrder: ActivityClaimOrder; jobs: Array<ActivityJobClaimOrder>}): ActivityClaimOrderJobsResult {
        return new ActivityClaimOrderJobsResult(
            obj.page,
            obj.claimOrder,
            obj.jobs
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityClaimOrderJobsResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityClaimOrderJobsResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityClaimOrderJobsResult'
    public baboonTypeIdentifier() {
        return ActivityClaimOrderJobsResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityClaimOrderJobsResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityClaimOrderJobsResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityClaimOrderJobsResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): ActivityClaimOrderJobsResult_JsonCodec {
        return ActivityClaimOrderJobsResult_JsonCodec.instance
    }
}

export class ActivityClaimOrderJobsResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityClaimOrderJobsResult): unknown {
        if (this !== ActivityClaimOrderJobsResult_JsonCodec.lazyInstance.value) {
          return ActivityClaimOrderJobsResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "page": ActivityJobsResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.page),
            "claimOrder": ActivityClaimOrder_JsonCodec.instance.encode(BaboonCodecContext.Default, value.claimOrder),
            "jobs": Array.from(value.jobs).map(item => ActivityJobClaimOrder_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityClaimOrderJobsResult {
        if (this !== ActivityClaimOrderJobsResult_JsonCodec .lazyInstance.value) {
            return ActivityClaimOrderJobsResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityClaimOrderJobsResult (
            ActivityJobsResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["page"]),
            ActivityClaimOrder_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["claimOrder"]),
            (obj["jobs"] as unknown[]).map(item => ActivityJobClaimOrder_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityClaimOrderJobsResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityClaimOrderJobsResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityClaimOrderJobsResult'
    public baboonTypeIdentifier() {
        return ActivityClaimOrderJobsResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityClaimOrderJobsResult_JsonCodec())
    public static get instance(): ActivityClaimOrderJobsResult_JsonCodec {
        return ActivityClaimOrderJobsResult_JsonCodec.lazyInstance.value
    }
}