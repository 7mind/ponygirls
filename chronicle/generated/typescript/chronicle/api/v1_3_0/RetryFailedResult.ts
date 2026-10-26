import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../../BaboonSharedRuntime.js'
import {RetryFailedCounts, RetryFailedCounts_JsonCodec} from './RetryFailedCounts.js'

export class RetryFailedResult implements BaboonGenerated {
    private readonly _requestId: string;
    private readonly _targetProfile: string;
    private readonly _retried: bigint;
    private readonly _counts: RetryFailedCounts;

    constructor(requestId: string, targetProfile: string, retried: bigint, counts: RetryFailedCounts) {
        this._requestId = requestId
        this._targetProfile = targetProfile
        this._retried = retried
        this._counts = counts
    }

    public get requestId(): string {
        return this._requestId;
    }
    public get targetProfile(): string {
        return this._targetProfile;
    }
    public get retried(): bigint {
        return this._retried;
    }
    public get counts(): RetryFailedCounts {
        return this._counts;
    }

    public toJSON(): Record<string, unknown> {
        return {
            requestId: this._requestId,
            targetProfile: this._targetProfile,
            retried: this._retried,
            counts: this._counts
        };
    }

    public with(overrides: {requestId?: string; targetProfile?: string; retried?: bigint; counts?: RetryFailedCounts}): RetryFailedResult {
        return new RetryFailedResult(
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'targetProfile' in overrides ? overrides.targetProfile! : this._targetProfile,
            'retried' in overrides ? overrides.retried! : this._retried,
            'counts' in overrides ? overrides.counts! : this._counts
        );
    }

    public static fromPlain(obj: {requestId: string; targetProfile: string; retried: bigint; counts: RetryFailedCounts}): RetryFailedResult {
        return new RetryFailedResult(
            obj.requestId,
            obj.targetProfile,
            obj.retried,
            obj.counts
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return RetryFailedResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RetryFailedResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RetryFailedResult'
    public baboonTypeIdentifier() {
        return RetryFailedResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return RetryFailedResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical", "1.4.0": "identical" }
    public baboonForwardReadable() {
        return RetryFailedResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return RetryFailedResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): RetryFailedResult_JsonCodec {
        return RetryFailedResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.3.0 is deprecated, you should migrate to 1.4.0 */
export class RetryFailedResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RetryFailedResult): unknown {
        if (this !== RetryFailedResult_JsonCodec.lazyInstance.value) {
          return RetryFailedResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "requestId": value.requestId,
            "targetProfile": value.targetProfile,
            "retried": value.retried.toString(),
            "counts": RetryFailedCounts_JsonCodec.instance.encode(BaboonCodecContext.Default, value.counts),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RetryFailedResult {
        if (this !== RetryFailedResult_JsonCodec .lazyInstance.value) {
            return RetryFailedResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RetryFailedResult (
            obj["requestId"] as string,
            obj["targetProfile"] as string,
            BaboonInt64.read(obj["retried"], "i64/u64"),
            RetryFailedCounts_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["counts"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return RetryFailedResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RetryFailedResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RetryFailedResult'
    public baboonTypeIdentifier() {
        return RetryFailedResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RetryFailedResult_JsonCodec())
    public static get instance(): RetryFailedResult_JsonCodec {
        return RetryFailedResult_JsonCodec.lazyInstance.value
    }
}