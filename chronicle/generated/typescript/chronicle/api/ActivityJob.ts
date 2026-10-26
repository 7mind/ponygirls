import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ActivityJobClass, ActivityJobClass_JsonCodec} from './ActivityJobClass.js'
import {JobInfo, JobInfo_JsonCodec} from './JobInfo.js'
import {SessionInfo, SessionInfo_JsonCodec} from './SessionInfo.js'

export class ActivityJob implements BaboonGeneratedLatest {
    private readonly _job: JobInfo;
    private readonly _profile: string;
    private readonly _classification: ActivityJobClass;
    private readonly _leaseExpiresAt: string | undefined;
    private readonly _leaseActive: boolean;
    private readonly _retryable: boolean;
    private readonly _collectorId: string;
    private readonly _session: SessionInfo;
    private readonly _lastTimestamp: string | undefined;

    constructor(job: JobInfo, profile: string, classification: ActivityJobClass, leaseExpiresAt: string | undefined, leaseActive: boolean, retryable: boolean, collectorId: string, session: SessionInfo, lastTimestamp: string | undefined) {
        this._job = job
        this._profile = profile
        this._classification = classification
        this._leaseExpiresAt = leaseExpiresAt
        this._leaseActive = leaseActive
        this._retryable = retryable
        this._collectorId = collectorId
        this._session = session
        this._lastTimestamp = lastTimestamp
    }

    public get job(): JobInfo {
        return this._job;
    }
    public get profile(): string {
        return this._profile;
    }
    public get classification(): ActivityJobClass {
        return this._classification;
    }
    public get leaseExpiresAt(): string | undefined {
        return this._leaseExpiresAt;
    }
    public get leaseActive(): boolean {
        return this._leaseActive;
    }
    public get retryable(): boolean {
        return this._retryable;
    }
    public get collectorId(): string {
        return this._collectorId;
    }
    public get session(): SessionInfo {
        return this._session;
    }
    public get lastTimestamp(): string | undefined {
        return this._lastTimestamp;
    }

    public toJSON(): Record<string, unknown> {
        return {
            job: this._job,
            profile: this._profile,
            classification: this._classification,
            leaseExpiresAt: this._leaseExpiresAt !== undefined ? this._leaseExpiresAt : undefined,
            leaseActive: this._leaseActive,
            retryable: this._retryable,
            collectorId: this._collectorId,
            session: this._session,
            lastTimestamp: this._lastTimestamp !== undefined ? this._lastTimestamp : undefined
        };
    }

    public with(overrides: {job?: JobInfo; profile?: string; classification?: ActivityJobClass; leaseExpiresAt?: string | undefined; leaseActive?: boolean; retryable?: boolean; collectorId?: string; session?: SessionInfo; lastTimestamp?: string | undefined}): ActivityJob {
        return new ActivityJob(
            'job' in overrides ? overrides.job! : this._job,
            'profile' in overrides ? overrides.profile! : this._profile,
            'classification' in overrides ? overrides.classification! : this._classification,
            'leaseExpiresAt' in overrides ? overrides.leaseExpiresAt! : this._leaseExpiresAt,
            'leaseActive' in overrides ? overrides.leaseActive! : this._leaseActive,
            'retryable' in overrides ? overrides.retryable! : this._retryable,
            'collectorId' in overrides ? overrides.collectorId! : this._collectorId,
            'session' in overrides ? overrides.session! : this._session,
            'lastTimestamp' in overrides ? overrides.lastTimestamp! : this._lastTimestamp
        );
    }

    public static fromPlain(obj: {job: JobInfo; profile: string; classification: ActivityJobClass; leaseExpiresAt: string | undefined; leaseActive: boolean; retryable: boolean; collectorId: string; session: SessionInfo; lastTimestamp: string | undefined}): ActivityJob {
        return new ActivityJob(
            obj.job,
            obj.profile,
            obj.classification,
            obj.leaseExpiresAt,
            obj.leaseActive,
            obj.retryable,
            obj.collectorId,
            obj.session,
            obj.lastTimestamp
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return ActivityJob.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJob.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityJob'
    public baboonTypeIdentifier() {
        return ActivityJob.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return ActivityJob.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return ActivityJob.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return ActivityJob.BaboonMinReaderVersions
    }
    public static jsonCodec(): ActivityJob_JsonCodec {
        return ActivityJob_JsonCodec.instance
    }
}

export class ActivityJob_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJob): unknown {
        if (this !== ActivityJob_JsonCodec.lazyInstance.value) {
          return ActivityJob_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "job": JobInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.job),
            "profile": value.profile,
            "classification": ActivityJobClass_JsonCodec.instance.encode(BaboonCodecContext.Default, value.classification),
            "leaseExpiresAt": value.leaseExpiresAt === undefined ? null : value.leaseExpiresAt,
            "leaseActive": value.leaseActive,
            "retryable": value.retryable,
            "collectorId": value.collectorId,
            "session": SessionInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.session),
            "lastTimestamp": value.lastTimestamp === undefined ? null : value.lastTimestamp,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJob {
        if (this !== ActivityJob_JsonCodec .lazyInstance.value) {
            return ActivityJob_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityJob (
            JobInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["job"]),
            obj["profile"] as string,
            ActivityJobClass_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["classification"]),
            obj["leaseExpiresAt"] === undefined || obj["leaseExpiresAt"] === null ? undefined : obj["leaseExpiresAt"] === undefined || obj["leaseExpiresAt"] === null ? undefined : obj["leaseExpiresAt"] as string,
            obj["leaseActive"] as boolean,
            obj["retryable"] as boolean,
            obj["collectorId"] as string,
            SessionInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["session"]),
            obj["lastTimestamp"] === undefined || obj["lastTimestamp"] === null ? undefined : obj["lastTimestamp"] === undefined || obj["lastTimestamp"] === null ? undefined : obj["lastTimestamp"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return ActivityJob_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJob_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityJob'
    public baboonTypeIdentifier() {
        return ActivityJob_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJob_JsonCodec())
    public static get instance(): ActivityJob_JsonCodec {
        return ActivityJob_JsonCodec.lazyInstance.value
    }
}