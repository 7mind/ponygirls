import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../../BaboonSharedRuntime.js'

export class OwnerReindexPlan implements BaboonGenerated {
    private readonly _currentTargetProfile: string;
    private readonly _targetProfile: string;
    private readonly _selectionHash: string;
    private readonly _heads: bigint;
    private readonly _alreadyCurrent: bigint;
    private readonly _replacements: bigint;

    constructor(currentTargetProfile: string, targetProfile: string, selectionHash: string, heads: bigint, alreadyCurrent: bigint, replacements: bigint) {
        this._currentTargetProfile = currentTargetProfile
        this._targetProfile = targetProfile
        this._selectionHash = selectionHash
        this._heads = heads
        this._alreadyCurrent = alreadyCurrent
        this._replacements = replacements
    }

    public get currentTargetProfile(): string {
        return this._currentTargetProfile;
    }
    public get targetProfile(): string {
        return this._targetProfile;
    }
    public get selectionHash(): string {
        return this._selectionHash;
    }
    public get heads(): bigint {
        return this._heads;
    }
    public get alreadyCurrent(): bigint {
        return this._alreadyCurrent;
    }
    public get replacements(): bigint {
        return this._replacements;
    }

    public toJSON(): Record<string, unknown> {
        return {
            currentTargetProfile: this._currentTargetProfile,
            targetProfile: this._targetProfile,
            selectionHash: this._selectionHash,
            heads: this._heads,
            alreadyCurrent: this._alreadyCurrent,
            replacements: this._replacements
        };
    }

    public with(overrides: {currentTargetProfile?: string; targetProfile?: string; selectionHash?: string; heads?: bigint; alreadyCurrent?: bigint; replacements?: bigint}): OwnerReindexPlan {
        return new OwnerReindexPlan(
            'currentTargetProfile' in overrides ? overrides.currentTargetProfile! : this._currentTargetProfile,
            'targetProfile' in overrides ? overrides.targetProfile! : this._targetProfile,
            'selectionHash' in overrides ? overrides.selectionHash! : this._selectionHash,
            'heads' in overrides ? overrides.heads! : this._heads,
            'alreadyCurrent' in overrides ? overrides.alreadyCurrent! : this._alreadyCurrent,
            'replacements' in overrides ? overrides.replacements! : this._replacements
        );
    }

    public static fromPlain(obj: {currentTargetProfile: string; targetProfile: string; selectionHash: string; heads: bigint; alreadyCurrent: bigint; replacements: bigint}): OwnerReindexPlan {
        return new OwnerReindexPlan(
            obj.currentTargetProfile,
            obj.targetProfile,
            obj.selectionHash,
            obj.heads,
            obj.alreadyCurrent,
            obj.replacements
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return OwnerReindexPlan.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return OwnerReindexPlan.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#OwnerReindexPlan'
    public baboonTypeIdentifier() {
        return OwnerReindexPlan.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0"]
    public baboonSameInVersions() {
        return OwnerReindexPlan.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical", "1.5.0": "identical" }
    public baboonForwardReadable() {
        return OwnerReindexPlan.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return OwnerReindexPlan.BaboonMinReaderVersions
    }
    public static jsonCodec(): OwnerReindexPlan_JsonCodec {
        return OwnerReindexPlan_JsonCodec.instance
    }
}

/** @deprecated Version 1.4.0 is deprecated, you should migrate to 1.5.0 */
export class OwnerReindexPlan_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: OwnerReindexPlan): unknown {
        if (this !== OwnerReindexPlan_JsonCodec.lazyInstance.value) {
          return OwnerReindexPlan_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "currentTargetProfile": value.currentTargetProfile,
            "targetProfile": value.targetProfile,
            "selectionHash": value.selectionHash,
            "heads": value.heads.toString(),
            "alreadyCurrent": value.alreadyCurrent.toString(),
            "replacements": value.replacements.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): OwnerReindexPlan {
        if (this !== OwnerReindexPlan_JsonCodec .lazyInstance.value) {
            return OwnerReindexPlan_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new OwnerReindexPlan (
            obj["currentTargetProfile"] as string,
            obj["targetProfile"] as string,
            obj["selectionHash"] as string,
            BaboonInt64.read(obj["heads"], "i64/u64"),
            BaboonInt64.read(obj["alreadyCurrent"], "i64/u64"),
            BaboonInt64.read(obj["replacements"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return OwnerReindexPlan_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return OwnerReindexPlan_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#OwnerReindexPlan'
    public baboonTypeIdentifier() {
        return OwnerReindexPlan_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new OwnerReindexPlan_JsonCodec())
    public static get instance(): OwnerReindexPlan_JsonCodec {
        return OwnerReindexPlan_JsonCodec.lazyInstance.value
    }
}