import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {CollectorStatus, CollectorStatus_JsonCodec} from './CollectorStatus.js'
import {JobCounts, JobCounts_JsonCodec} from './JobCounts.js'

export class ActivityCollector implements BaboonGeneratedLatest {
    private readonly _collectorId: string;
    private readonly _status: CollectorStatus | undefined;
    private readonly _archiveHeads: bigint;
    private readonly _headsWithoutTargetJob: bigint;
    private readonly _current: JobCounts;
    private readonly _historical: JobCounts;

    constructor(collectorId: string, status: CollectorStatus | undefined, archiveHeads: bigint, headsWithoutTargetJob: bigint, current: JobCounts, historical: JobCounts) {
        this._collectorId = collectorId
        this._status = status
        this._archiveHeads = archiveHeads
        this._headsWithoutTargetJob = headsWithoutTargetJob
        this._current = current
        this._historical = historical
    }

    public get collectorId(): string {
        return this._collectorId;
    }
    public get status(): CollectorStatus | undefined {
        return this._status;
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

    public toJSON(): Record<string, unknown> {
        return {
            collectorId: this._collectorId,
            status: this._status !== undefined ? this._status : undefined,
            archiveHeads: this._archiveHeads,
            headsWithoutTargetJob: this._headsWithoutTargetJob,
            current: this._current,
            historical: this._historical
        };
    }

    public with(overrides: {collectorId?: string; status?: CollectorStatus | undefined; archiveHeads?: bigint; headsWithoutTargetJob?: bigint; current?: JobCounts; historical?: JobCounts}): ActivityCollector {
        return new ActivityCollector(
            'collectorId' in overrides ? overrides.collectorId! : this._collectorId,
            'status' in overrides ? overrides.status! : this._status,
            'archiveHeads' in overrides ? overrides.archiveHeads! : this._archiveHeads,
            'headsWithoutTargetJob' in overrides ? overrides.headsWithoutTargetJob! : this._headsWithoutTargetJob,
            'current' in overrides ? overrides.current! : this._current,
            'historical' in overrides ? overrides.historical! : this._historical
        );
    }

    public static fromPlain(obj: {collectorId: string; status: CollectorStatus | undefined; archiveHeads: bigint; headsWithoutTargetJob: bigint; current: JobCounts; historical: JobCounts}): ActivityCollector {
        return new ActivityCollector(
            obj.collectorId,
            obj.status,
            obj.archiveHeads,
            obj.headsWithoutTargetJob,
            obj.current,
            obj.historical
        );
    }

    public static readonly BaboonDomainVersion = '1.8.0'
    public baboonDomainVersion() {
        return ActivityCollector.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityCollector.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityCollector'
    public baboonTypeIdentifier() {
        return ActivityCollector.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return ActivityCollector.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.8.0": "identical" }
    public baboonForwardReadable() {
        return ActivityCollector.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return ActivityCollector.BaboonMinReaderVersions
    }
    public static jsonCodec(): ActivityCollector_JsonCodec {
        return ActivityCollector_JsonCodec.instance
    }
}

export class ActivityCollector_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityCollector): unknown {
        if (this !== ActivityCollector_JsonCodec.lazyInstance.value) {
          return ActivityCollector_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "collectorId": value.collectorId,
            "status": value.status === undefined ? null : CollectorStatus_JsonCodec.instance.encode(BaboonCodecContext.Default, value.status),
            "archiveHeads": value.archiveHeads.toString(),
            "headsWithoutTargetJob": value.headsWithoutTargetJob.toString(),
            "current": JobCounts_JsonCodec.instance.encode(BaboonCodecContext.Default, value.current),
            "historical": JobCounts_JsonCodec.instance.encode(BaboonCodecContext.Default, value.historical),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityCollector {
        if (this !== ActivityCollector_JsonCodec .lazyInstance.value) {
            return ActivityCollector_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityCollector (
            obj["collectorId"] as string,
            obj["status"] === undefined || obj["status"] === null ? undefined : obj["status"] === undefined || obj["status"] === null ? undefined : CollectorStatus_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["status"]),
            BaboonInt64.read(obj["archiveHeads"], "i64/u64"),
            BaboonInt64.read(obj["headsWithoutTargetJob"], "i64/u64"),
            JobCounts_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["current"]),
            JobCounts_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["historical"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.8.0'
    public baboonDomainVersion() {
        return ActivityCollector_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityCollector_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityCollector'
    public baboonTypeIdentifier() {
        return ActivityCollector_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityCollector_JsonCodec())
    public static get instance(): ActivityCollector_JsonCodec {
        return ActivityCollector_JsonCodec.lazyInstance.value
    }
}