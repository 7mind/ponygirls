import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../../BaboonSharedRuntime.js'
import {ActivityCollector, ActivityCollector_JsonCodec} from './ActivityCollector.js'
import {JobCounts, JobCounts_JsonCodec} from './JobCounts.js'
import {UserInfo, UserInfo_JsonCodec} from './UserInfo.js'

export class ActivityResult implements BaboonGenerated {
    private readonly _observedAt: string;
    private readonly _user: UserInfo;
    private readonly _archiveHeads: bigint;
    private readonly _headsWithoutTargetJob: bigint;
    private readonly _current: JobCounts;
    private readonly _historical: JobCounts;
    private readonly _collectors: Array<ActivityCollector>;
    private readonly _totalCollectors: bigint;
    private readonly _allCollectors: bigint;
    private readonly _nextCursor: string | undefined;

    constructor(observedAt: string, user: UserInfo, archiveHeads: bigint, headsWithoutTargetJob: bigint, current: JobCounts, historical: JobCounts, collectors: Array<ActivityCollector>, totalCollectors: bigint, allCollectors: bigint, nextCursor: string | undefined) {
        this._observedAt = observedAt
        this._user = user
        this._archiveHeads = archiveHeads
        this._headsWithoutTargetJob = headsWithoutTargetJob
        this._current = current
        this._historical = historical
        this._collectors = collectors
        this._totalCollectors = totalCollectors
        this._allCollectors = allCollectors
        this._nextCursor = nextCursor
    }

    public get observedAt(): string {
        return this._observedAt;
    }
    public get user(): UserInfo {
        return this._user;
    }
    public get archiveHeads(): bigint {
        return this._archiveHeads;
    }
    public get headsWithoutTargetJob(): bigint {
        return this._headsWithoutTargetJob;
    }
    public get current(): JobCounts {
        return this._current;
    }
    public get historical(): JobCounts {
        return this._historical;
    }
    public get collectors(): Array<ActivityCollector> {
        return this._collectors;
    }
    public get totalCollectors(): bigint {
        return this._totalCollectors;
    }
    public get allCollectors(): bigint {
        return this._allCollectors;
    }
    public get nextCursor(): string | undefined {
        return this._nextCursor;
    }

    public toJSON(): Record<string, unknown> {
        return {
            observedAt: this._observedAt,
            user: this._user,
            archiveHeads: this._archiveHeads,
            headsWithoutTargetJob: this._headsWithoutTargetJob,
            current: this._current,
            historical: this._historical,
            collectors: this._collectors,
            totalCollectors: this._totalCollectors,
            allCollectors: this._allCollectors,
            nextCursor: this._nextCursor !== undefined ? this._nextCursor : undefined
        };
    }

    public with(overrides: {observedAt?: string; user?: UserInfo; archiveHeads?: bigint; headsWithoutTargetJob?: bigint; current?: JobCounts; historical?: JobCounts; collectors?: Array<ActivityCollector>; totalCollectors?: bigint; allCollectors?: bigint; nextCursor?: string | undefined}): ActivityResult {
        return new ActivityResult(
            'observedAt' in overrides ? overrides.observedAt! : this._observedAt,
            'user' in overrides ? overrides.user! : this._user,
            'archiveHeads' in overrides ? overrides.archiveHeads! : this._archiveHeads,
            'headsWithoutTargetJob' in overrides ? overrides.headsWithoutTargetJob! : this._headsWithoutTargetJob,
            'current' in overrides ? overrides.current! : this._current,
            'historical' in overrides ? overrides.historical! : this._historical,
            'collectors' in overrides ? overrides.collectors! : this._collectors,
            'totalCollectors' in overrides ? overrides.totalCollectors! : this._totalCollectors,
            'allCollectors' in overrides ? overrides.allCollectors! : this._allCollectors,
            'nextCursor' in overrides ? overrides.nextCursor! : this._nextCursor
        );
    }

    public static fromPlain(obj: {observedAt: string; user: UserInfo; archiveHeads: bigint; headsWithoutTargetJob: bigint; current: JobCounts; historical: JobCounts; collectors: Array<ActivityCollector>; totalCollectors: bigint; allCollectors: bigint; nextCursor: string | undefined}): ActivityResult {
        return new ActivityResult(
            obj.observedAt,
            obj.user,
            obj.archiveHeads,
            obj.headsWithoutTargetJob,
            obj.current,
            obj.historical,
            obj.collectors,
            obj.totalCollectors,
            obj.allCollectors,
            obj.nextCursor
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return ActivityResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityResult'
    public baboonTypeIdentifier() {
        return ActivityResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0", "1.5.0"]
    public baboonSameInVersions() {
        return ActivityResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical", "1.5.0": "identical" }
    public baboonForwardReadable() {
        return ActivityResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return ActivityResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): ActivityResult_JsonCodec {
        return ActivityResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.4.0 is deprecated, you should migrate to 1.5.0 */
export class ActivityResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityResult): unknown {
        if (this !== ActivityResult_JsonCodec.lazyInstance.value) {
          return ActivityResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "observedAt": value.observedAt,
            "user": UserInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.user),
            "archiveHeads": value.archiveHeads.toString(),
            "headsWithoutTargetJob": value.headsWithoutTargetJob.toString(),
            "current": JobCounts_JsonCodec.instance.encode(BaboonCodecContext.Default, value.current),
            "historical": JobCounts_JsonCodec.instance.encode(BaboonCodecContext.Default, value.historical),
            "collectors": Array.from(value.collectors).map(item => ActivityCollector_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "totalCollectors": value.totalCollectors.toString(),
            "allCollectors": value.allCollectors.toString(),
            "nextCursor": value.nextCursor === undefined ? null : value.nextCursor,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityResult {
        if (this !== ActivityResult_JsonCodec .lazyInstance.value) {
            return ActivityResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityResult (
            obj["observedAt"] as string,
            UserInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["user"]),
            BaboonInt64.read(obj["archiveHeads"], "i64/u64"),
            BaboonInt64.read(obj["headsWithoutTargetJob"], "i64/u64"),
            JobCounts_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["current"]),
            JobCounts_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["historical"]),
            (obj["collectors"] as unknown[]).map(item => ActivityCollector_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            BaboonInt64.read(obj["totalCollectors"], "i64/u64"),
            BaboonInt64.read(obj["allCollectors"], "i64/u64"),
            obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return ActivityResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityResult'
    public baboonTypeIdentifier() {
        return ActivityResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityResult_JsonCodec())
    public static get instance(): ActivityResult_JsonCodec {
        return ActivityResult_JsonCodec.lazyInstance.value
    }
}