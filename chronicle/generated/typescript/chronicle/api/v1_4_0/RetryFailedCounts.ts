import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../../BaboonSharedRuntime.js'

export class RetryFailedCounts implements BaboonGenerated {
    private readonly _eligibleCurrentFailed: bigint;
    private readonly _supersededRevisionFailed: bigint;
    private readonly _obsoleteProfileFailed: bigint;
    private readonly _supersededRevisionAndProfileFailed: bigint;
    private readonly _unchangedQueued: bigint;
    private readonly _unchangedRunning: bigint;
    private readonly _unchangedComplete: bigint;

    constructor(eligibleCurrentFailed: bigint, supersededRevisionFailed: bigint, obsoleteProfileFailed: bigint, supersededRevisionAndProfileFailed: bigint, unchangedQueued: bigint, unchangedRunning: bigint, unchangedComplete: bigint) {
        this._eligibleCurrentFailed = eligibleCurrentFailed
        this._supersededRevisionFailed = supersededRevisionFailed
        this._obsoleteProfileFailed = obsoleteProfileFailed
        this._supersededRevisionAndProfileFailed = supersededRevisionAndProfileFailed
        this._unchangedQueued = unchangedQueued
        this._unchangedRunning = unchangedRunning
        this._unchangedComplete = unchangedComplete
    }

    public get eligibleCurrentFailed(): bigint {
        return this._eligibleCurrentFailed;
    }
    public get supersededRevisionFailed(): bigint {
        return this._supersededRevisionFailed;
    }
    public get obsoleteProfileFailed(): bigint {
        return this._obsoleteProfileFailed;
    }
    public get supersededRevisionAndProfileFailed(): bigint {
        return this._supersededRevisionAndProfileFailed;
    }
    public get unchangedQueued(): bigint {
        return this._unchangedQueued;
    }
    public get unchangedRunning(): bigint {
        return this._unchangedRunning;
    }
    public get unchangedComplete(): bigint {
        return this._unchangedComplete;
    }

    public toJSON(): Record<string, unknown> {
        return {
            eligibleCurrentFailed: this._eligibleCurrentFailed,
            supersededRevisionFailed: this._supersededRevisionFailed,
            obsoleteProfileFailed: this._obsoleteProfileFailed,
            supersededRevisionAndProfileFailed: this._supersededRevisionAndProfileFailed,
            unchangedQueued: this._unchangedQueued,
            unchangedRunning: this._unchangedRunning,
            unchangedComplete: this._unchangedComplete
        };
    }

    public with(overrides: {eligibleCurrentFailed?: bigint; supersededRevisionFailed?: bigint; obsoleteProfileFailed?: bigint; supersededRevisionAndProfileFailed?: bigint; unchangedQueued?: bigint; unchangedRunning?: bigint; unchangedComplete?: bigint}): RetryFailedCounts {
        return new RetryFailedCounts(
            'eligibleCurrentFailed' in overrides ? overrides.eligibleCurrentFailed! : this._eligibleCurrentFailed,
            'supersededRevisionFailed' in overrides ? overrides.supersededRevisionFailed! : this._supersededRevisionFailed,
            'obsoleteProfileFailed' in overrides ? overrides.obsoleteProfileFailed! : this._obsoleteProfileFailed,
            'supersededRevisionAndProfileFailed' in overrides ? overrides.supersededRevisionAndProfileFailed! : this._supersededRevisionAndProfileFailed,
            'unchangedQueued' in overrides ? overrides.unchangedQueued! : this._unchangedQueued,
            'unchangedRunning' in overrides ? overrides.unchangedRunning! : this._unchangedRunning,
            'unchangedComplete' in overrides ? overrides.unchangedComplete! : this._unchangedComplete
        );
    }

    public static fromPlain(obj: {eligibleCurrentFailed: bigint; supersededRevisionFailed: bigint; obsoleteProfileFailed: bigint; supersededRevisionAndProfileFailed: bigint; unchangedQueued: bigint; unchangedRunning: bigint; unchangedComplete: bigint}): RetryFailedCounts {
        return new RetryFailedCounts(
            obj.eligibleCurrentFailed,
            obj.supersededRevisionFailed,
            obj.obsoleteProfileFailed,
            obj.supersededRevisionAndProfileFailed,
            obj.unchangedQueued,
            obj.unchangedRunning,
            obj.unchangedComplete
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return RetryFailedCounts.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RetryFailedCounts.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RetryFailedCounts'
    public baboonTypeIdentifier() {
        return RetryFailedCounts.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0", "1.5.0"]
    public baboonSameInVersions() {
        return RetryFailedCounts.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical", "1.5.0": "identical" }
    public baboonForwardReadable() {
        return RetryFailedCounts.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return RetryFailedCounts.BaboonMinReaderVersions
    }
    public static jsonCodec(): RetryFailedCounts_JsonCodec {
        return RetryFailedCounts_JsonCodec.instance
    }
}

/** @deprecated Version 1.4.0 is deprecated, you should migrate to 1.5.0 */
export class RetryFailedCounts_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RetryFailedCounts): unknown {
        if (this !== RetryFailedCounts_JsonCodec.lazyInstance.value) {
          return RetryFailedCounts_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "eligibleCurrentFailed": value.eligibleCurrentFailed.toString(),
            "supersededRevisionFailed": value.supersededRevisionFailed.toString(),
            "obsoleteProfileFailed": value.obsoleteProfileFailed.toString(),
            "supersededRevisionAndProfileFailed": value.supersededRevisionAndProfileFailed.toString(),
            "unchangedQueued": value.unchangedQueued.toString(),
            "unchangedRunning": value.unchangedRunning.toString(),
            "unchangedComplete": value.unchangedComplete.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RetryFailedCounts {
        if (this !== RetryFailedCounts_JsonCodec .lazyInstance.value) {
            return RetryFailedCounts_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RetryFailedCounts (
            BaboonInt64.read(obj["eligibleCurrentFailed"], "i64/u64"),
            BaboonInt64.read(obj["supersededRevisionFailed"], "i64/u64"),
            BaboonInt64.read(obj["obsoleteProfileFailed"], "i64/u64"),
            BaboonInt64.read(obj["supersededRevisionAndProfileFailed"], "i64/u64"),
            BaboonInt64.read(obj["unchangedQueued"], "i64/u64"),
            BaboonInt64.read(obj["unchangedRunning"], "i64/u64"),
            BaboonInt64.read(obj["unchangedComplete"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return RetryFailedCounts_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RetryFailedCounts_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RetryFailedCounts'
    public baboonTypeIdentifier() {
        return RetryFailedCounts_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RetryFailedCounts_JsonCodec())
    public static get instance(): RetryFailedCounts_JsonCodec {
        return RetryFailedCounts_JsonCodec.lazyInstance.value
    }
}