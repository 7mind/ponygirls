import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../../BaboonSharedRuntime.js'

export class OwnerReindexResult implements BaboonGenerated {
    private readonly _requestId: string;
    private readonly _targetProfile: string;
    private readonly _heads: bigint;
    private readonly _queued: bigint;
    private readonly _alreadyCurrent: bigint;
    private readonly _invalidatedClaims: bigint;

    constructor(requestId: string, targetProfile: string, heads: bigint, queued: bigint, alreadyCurrent: bigint, invalidatedClaims: bigint) {
        this._requestId = requestId
        this._targetProfile = targetProfile
        this._heads = heads
        this._queued = queued
        this._alreadyCurrent = alreadyCurrent
        this._invalidatedClaims = invalidatedClaims
    }

    public get requestId(): string {
        return this._requestId;
    }
    public get targetProfile(): string {
        return this._targetProfile;
    }
    public get heads(): bigint {
        return this._heads;
    }
    public get queued(): bigint {
        return this._queued;
    }
    public get alreadyCurrent(): bigint {
        return this._alreadyCurrent;
    }
    public get invalidatedClaims(): bigint {
        return this._invalidatedClaims;
    }

    public toJSON(): Record<string, unknown> {
        return {
            requestId: this._requestId,
            targetProfile: this._targetProfile,
            heads: this._heads,
            queued: this._queued,
            alreadyCurrent: this._alreadyCurrent,
            invalidatedClaims: this._invalidatedClaims
        };
    }

    public with(overrides: {requestId?: string; targetProfile?: string; heads?: bigint; queued?: bigint; alreadyCurrent?: bigint; invalidatedClaims?: bigint}): OwnerReindexResult {
        return new OwnerReindexResult(
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'targetProfile' in overrides ? overrides.targetProfile! : this._targetProfile,
            'heads' in overrides ? overrides.heads! : this._heads,
            'queued' in overrides ? overrides.queued! : this._queued,
            'alreadyCurrent' in overrides ? overrides.alreadyCurrent! : this._alreadyCurrent,
            'invalidatedClaims' in overrides ? overrides.invalidatedClaims! : this._invalidatedClaims
        );
    }

    public static fromPlain(obj: {requestId: string; targetProfile: string; heads: bigint; queued: bigint; alreadyCurrent: bigint; invalidatedClaims: bigint}): OwnerReindexResult {
        return new OwnerReindexResult(
            obj.requestId,
            obj.targetProfile,
            obj.heads,
            obj.queued,
            obj.alreadyCurrent,
            obj.invalidatedClaims
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return OwnerReindexResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return OwnerReindexResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#OwnerReindexResult'
    public baboonTypeIdentifier() {
        return OwnerReindexResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0"]
    public baboonSameInVersions() {
        return OwnerReindexResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical", "1.5.0": "identical" }
    public baboonForwardReadable() {
        return OwnerReindexResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return OwnerReindexResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): OwnerReindexResult_JsonCodec {
        return OwnerReindexResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.4.0 is deprecated, you should migrate to 1.5.0 */
export class OwnerReindexResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: OwnerReindexResult): unknown {
        if (this !== OwnerReindexResult_JsonCodec.lazyInstance.value) {
          return OwnerReindexResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "requestId": value.requestId,
            "targetProfile": value.targetProfile,
            "heads": value.heads.toString(),
            "queued": value.queued.toString(),
            "alreadyCurrent": value.alreadyCurrent.toString(),
            "invalidatedClaims": value.invalidatedClaims.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): OwnerReindexResult {
        if (this !== OwnerReindexResult_JsonCodec .lazyInstance.value) {
            return OwnerReindexResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new OwnerReindexResult (
            obj["requestId"] as string,
            obj["targetProfile"] as string,
            BaboonInt64.read(obj["heads"], "i64/u64"),
            BaboonInt64.read(obj["queued"], "i64/u64"),
            BaboonInt64.read(obj["alreadyCurrent"], "i64/u64"),
            BaboonInt64.read(obj["invalidatedClaims"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return OwnerReindexResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return OwnerReindexResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#OwnerReindexResult'
    public baboonTypeIdentifier() {
        return OwnerReindexResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new OwnerReindexResult_JsonCodec())
    public static get instance(): OwnerReindexResult_JsonCodec {
        return OwnerReindexResult_JsonCodec.lazyInstance.value
    }
}