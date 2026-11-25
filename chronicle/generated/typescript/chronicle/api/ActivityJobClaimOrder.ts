import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {ActivityJobWaiting, ActivityJobWaiting_JsonCodec} from './ActivityJobWaiting.js'

export class ActivityJobClaimOrder implements BaboonGeneratedLatest {
    private readonly _jobId: string;
    private readonly _waitingSince: string | undefined;
    private readonly _bulk: boolean | undefined;
    private readonly _waiting: ActivityJobWaiting | undefined;
    private readonly _ahead: bigint | undefined;

    constructor(jobId: string, waitingSince: string | undefined, bulk: boolean | undefined, waiting: ActivityJobWaiting | undefined, ahead: bigint | undefined) {
        this._jobId = jobId
        this._waitingSince = waitingSince
        this._bulk = bulk
        this._waiting = waiting
        this._ahead = ahead
    }

    public get jobId(): string {
        return this._jobId;
    }
    public get waitingSince(): string | undefined {
        return this._waitingSince;
    }
    public get bulk(): boolean | undefined {
        return this._bulk;
    }
    public get waiting(): ActivityJobWaiting | undefined {
        return this._waiting;
    }
    public get ahead(): bigint | undefined {
        return this._ahead;
    }

    public toJSON(): Record<string, unknown> {
        return {
            jobId: this._jobId,
            waitingSince: this._waitingSince !== undefined ? this._waitingSince : undefined,
            bulk: this._bulk !== undefined ? this._bulk : undefined,
            waiting: this._waiting !== undefined ? this._waiting : undefined,
            ahead: this._ahead !== undefined ? this._ahead : undefined
        };
    }

    public with(overrides: {jobId?: string; waitingSince?: string | undefined; bulk?: boolean | undefined; waiting?: ActivityJobWaiting | undefined; ahead?: bigint | undefined}): ActivityJobClaimOrder {
        return new ActivityJobClaimOrder(
            'jobId' in overrides ? overrides.jobId! : this._jobId,
            'waitingSince' in overrides ? overrides.waitingSince! : this._waitingSince,
            'bulk' in overrides ? overrides.bulk! : this._bulk,
            'waiting' in overrides ? overrides.waiting! : this._waiting,
            'ahead' in overrides ? overrides.ahead! : this._ahead
        );
    }

    public static fromPlain(obj: {jobId: string; waitingSince: string | undefined; bulk: boolean | undefined; waiting: ActivityJobWaiting | undefined; ahead: bigint | undefined}): ActivityJobClaimOrder {
        return new ActivityJobClaimOrder(
            obj.jobId,
            obj.waitingSince,
            obj.bulk,
            obj.waiting,
            obj.ahead
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobClaimOrder.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobClaimOrder.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityJobClaimOrder'
    public baboonTypeIdentifier() {
        return ActivityJobClaimOrder.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityJobClaimOrder.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityJobClaimOrder.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityJobClaimOrder.BaboonMinReaderVersions
    }
    public static jsonCodec(): ActivityJobClaimOrder_JsonCodec {
        return ActivityJobClaimOrder_JsonCodec.instance
    }
}

export class ActivityJobClaimOrder_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobClaimOrder): unknown {
        if (this !== ActivityJobClaimOrder_JsonCodec.lazyInstance.value) {
          return ActivityJobClaimOrder_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "jobId": value.jobId,
            "waitingSince": value.waitingSince === undefined ? null : value.waitingSince,
            "bulk": value.bulk === undefined ? null : value.bulk,
            "waiting": value.waiting === undefined ? null : ActivityJobWaiting_JsonCodec.instance.encode(BaboonCodecContext.Default, value.waiting),
            "ahead": value.ahead === undefined ? null : value.ahead.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobClaimOrder {
        if (this !== ActivityJobClaimOrder_JsonCodec .lazyInstance.value) {
            return ActivityJobClaimOrder_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityJobClaimOrder (
            obj["jobId"] as string,
            obj["waitingSince"] === undefined || obj["waitingSince"] === null ? undefined : obj["waitingSince"] === undefined || obj["waitingSince"] === null ? undefined : obj["waitingSince"] as string,
            obj["bulk"] === undefined || obj["bulk"] === null ? undefined : obj["bulk"] === undefined || obj["bulk"] === null ? undefined : obj["bulk"] as boolean,
            obj["waiting"] === undefined || obj["waiting"] === null ? undefined : obj["waiting"] === undefined || obj["waiting"] === null ? undefined : ActivityJobWaiting_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["waiting"]),
            obj["ahead"] === undefined || obj["ahead"] === null ? undefined : obj["ahead"] === undefined || obj["ahead"] === null ? undefined : BaboonInt64.read(obj["ahead"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobClaimOrder_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobClaimOrder_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityJobClaimOrder'
    public baboonTypeIdentifier() {
        return ActivityJobClaimOrder_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobClaimOrder_JsonCodec())
    public static get instance(): ActivityJobClaimOrder_JsonCodec {
        return ActivityJobClaimOrder_JsonCodec.lazyInstance.value
    }
}