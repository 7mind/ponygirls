import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../../BaboonSharedRuntime.js'

export class ReindexStatusResult implements BaboonGenerated {
    private readonly _requestId: string;
    private readonly _targetProfile: string;
    private readonly _total: bigint;
    private readonly _complete: bigint;
    private readonly _superseded: bigint;
    private readonly _failed: bigint;
    private readonly _pending: bigint;

    constructor(requestId: string, targetProfile: string, total: bigint, complete: bigint, superseded: bigint, failed: bigint, pending: bigint) {
        this._requestId = requestId
        this._targetProfile = targetProfile
        this._total = total
        this._complete = complete
        this._superseded = superseded
        this._failed = failed
        this._pending = pending
    }

    public get requestId(): string {
        return this._requestId;
    }
    public get targetProfile(): string {
        return this._targetProfile;
    }
    public get total(): bigint {
        return this._total;
    }
    public get complete(): bigint {
        return this._complete;
    }
    public get superseded(): bigint {
        return this._superseded;
    }
    public get failed(): bigint {
        return this._failed;
    }
    public get pending(): bigint {
        return this._pending;
    }

    public toJSON(): Record<string, unknown> {
        return {
            requestId: this._requestId,
            targetProfile: this._targetProfile,
            total: this._total,
            complete: this._complete,
            superseded: this._superseded,
            failed: this._failed,
            pending: this._pending
        };
    }

    public with(overrides: {requestId?: string; targetProfile?: string; total?: bigint; complete?: bigint; superseded?: bigint; failed?: bigint; pending?: bigint}): ReindexStatusResult {
        return new ReindexStatusResult(
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'targetProfile' in overrides ? overrides.targetProfile! : this._targetProfile,
            'total' in overrides ? overrides.total! : this._total,
            'complete' in overrides ? overrides.complete! : this._complete,
            'superseded' in overrides ? overrides.superseded! : this._superseded,
            'failed' in overrides ? overrides.failed! : this._failed,
            'pending' in overrides ? overrides.pending! : this._pending
        );
    }

    public static fromPlain(obj: {requestId: string; targetProfile: string; total: bigint; complete: bigint; superseded: bigint; failed: bigint; pending: bigint}): ReindexStatusResult {
        return new ReindexStatusResult(
            obj.requestId,
            obj.targetProfile,
            obj.total,
            obj.complete,
            obj.superseded,
            obj.failed,
            obj.pending
        );
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return ReindexStatusResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ReindexStatusResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ReindexStatusResult'
    public baboonTypeIdentifier() {
        return ReindexStatusResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return ReindexStatusResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return ReindexStatusResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.7.0", "prefix-compact": "1.7.0", "prefix-any-mode": "1.7.0", "identical": "1.7.0" }
    public baboonMinReaderVersions() {
        return ReindexStatusResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): ReindexStatusResult_JsonCodec {
        return ReindexStatusResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.7.0 is deprecated, you should migrate to 1.8.0 */
export class ReindexStatusResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ReindexStatusResult): unknown {
        if (this !== ReindexStatusResult_JsonCodec.lazyInstance.value) {
          return ReindexStatusResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "requestId": value.requestId,
            "targetProfile": value.targetProfile,
            "total": value.total.toString(),
            "complete": value.complete.toString(),
            "superseded": value.superseded.toString(),
            "failed": value.failed.toString(),
            "pending": value.pending.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ReindexStatusResult {
        if (this !== ReindexStatusResult_JsonCodec .lazyInstance.value) {
            return ReindexStatusResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ReindexStatusResult (
            obj["requestId"] as string,
            obj["targetProfile"] as string,
            BaboonInt64.read(obj["total"], "i64/u64"),
            BaboonInt64.read(obj["complete"], "i64/u64"),
            BaboonInt64.read(obj["superseded"], "i64/u64"),
            BaboonInt64.read(obj["failed"], "i64/u64"),
            BaboonInt64.read(obj["pending"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return ReindexStatusResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ReindexStatusResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ReindexStatusResult'
    public baboonTypeIdentifier() {
        return ReindexStatusResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ReindexStatusResult_JsonCodec())
    public static get instance(): ReindexStatusResult_JsonCodec {
        return ReindexStatusResult_JsonCodec.lazyInstance.value
    }
}