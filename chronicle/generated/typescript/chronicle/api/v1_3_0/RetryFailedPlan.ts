import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {RetryFailedCounts, RetryFailedCounts_JsonCodec} from './RetryFailedCounts.js'

export class RetryFailedPlan implements BaboonGenerated {
    private readonly _targetProfile: string;
    private readonly _selectionHash: string;
    private readonly _counts: RetryFailedCounts;

    constructor(targetProfile: string, selectionHash: string, counts: RetryFailedCounts) {
        this._targetProfile = targetProfile
        this._selectionHash = selectionHash
        this._counts = counts
    }

    public get targetProfile(): string {
        return this._targetProfile;
    }
    public get selectionHash(): string {
        return this._selectionHash;
    }
    public get counts(): RetryFailedCounts {
        return this._counts;
    }

    public toJSON(): Record<string, unknown> {
        return {
            targetProfile: this._targetProfile,
            selectionHash: this._selectionHash,
            counts: this._counts
        };
    }

    public with(overrides: {targetProfile?: string; selectionHash?: string; counts?: RetryFailedCounts}): RetryFailedPlan {
        return new RetryFailedPlan(
            'targetProfile' in overrides ? overrides.targetProfile! : this._targetProfile,
            'selectionHash' in overrides ? overrides.selectionHash! : this._selectionHash,
            'counts' in overrides ? overrides.counts! : this._counts
        );
    }

    public static fromPlain(obj: {targetProfile: string; selectionHash: string; counts: RetryFailedCounts}): RetryFailedPlan {
        return new RetryFailedPlan(
            obj.targetProfile,
            obj.selectionHash,
            obj.counts
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return RetryFailedPlan.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RetryFailedPlan.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RetryFailedPlan'
    public baboonTypeIdentifier() {
        return RetryFailedPlan.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0", "1.5.0"]
    public baboonSameInVersions() {
        return RetryFailedPlan.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical" }
    public baboonForwardReadable() {
        return RetryFailedPlan.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return RetryFailedPlan.BaboonMinReaderVersions
    }
    public static jsonCodec(): RetryFailedPlan_JsonCodec {
        return RetryFailedPlan_JsonCodec.instance
    }
}

/** @deprecated Version 1.3.0 is deprecated, you should migrate to 1.5.0 */
export class RetryFailedPlan_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RetryFailedPlan): unknown {
        if (this !== RetryFailedPlan_JsonCodec.lazyInstance.value) {
          return RetryFailedPlan_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "targetProfile": value.targetProfile,
            "selectionHash": value.selectionHash,
            "counts": RetryFailedCounts_JsonCodec.instance.encode(BaboonCodecContext.Default, value.counts),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RetryFailedPlan {
        if (this !== RetryFailedPlan_JsonCodec .lazyInstance.value) {
            return RetryFailedPlan_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RetryFailedPlan (
            obj["targetProfile"] as string,
            obj["selectionHash"] as string,
            RetryFailedCounts_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["counts"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return RetryFailedPlan_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RetryFailedPlan_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RetryFailedPlan'
    public baboonTypeIdentifier() {
        return RetryFailedPlan_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RetryFailedPlan_JsonCodec())
    public static get instance(): RetryFailedPlan_JsonCodec {
        return RetryFailedPlan_JsonCodec.lazyInstance.value
    }
}