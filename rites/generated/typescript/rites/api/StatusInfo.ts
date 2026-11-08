import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'

export class StatusInfo implements BaboonGeneratedLatest {
    private readonly _queuedRuns: bigint;
    private readonly _activeRuns: bigint;
    private readonly _schedulerEnabled: boolean;

    constructor(queuedRuns: bigint, activeRuns: bigint, schedulerEnabled: boolean) {
        this._queuedRuns = queuedRuns
        this._activeRuns = activeRuns
        this._schedulerEnabled = schedulerEnabled
    }

    public get queuedRuns(): bigint {
        return this._queuedRuns;
    }
    public get activeRuns(): bigint {
        return this._activeRuns;
    }
    public get schedulerEnabled(): boolean {
        return this._schedulerEnabled;
    }

    public toJSON(): Record<string, unknown> {
        return {
            queuedRuns: this._queuedRuns,
            activeRuns: this._activeRuns,
            schedulerEnabled: this._schedulerEnabled
        };
    }

    public with(overrides: {queuedRuns?: bigint; activeRuns?: bigint; schedulerEnabled?: boolean}): StatusInfo {
        return new StatusInfo(
            'queuedRuns' in overrides ? overrides.queuedRuns! : this._queuedRuns,
            'activeRuns' in overrides ? overrides.activeRuns! : this._activeRuns,
            'schedulerEnabled' in overrides ? overrides.schedulerEnabled! : this._schedulerEnabled
        );
    }

    public static fromPlain(obj: {queuedRuns: bigint; activeRuns: bigint; schedulerEnabled: boolean}): StatusInfo {
        return new StatusInfo(
            obj.queuedRuns,
            obj.activeRuns,
            obj.schedulerEnabled
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return StatusInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return StatusInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#StatusInfo'
    public baboonTypeIdentifier() {
        return StatusInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return StatusInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return StatusInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return StatusInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): StatusInfo_JsonCodec {
        return StatusInfo_JsonCodec.instance
    }
}

export class StatusInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: StatusInfo): unknown {
        if (this !== StatusInfo_JsonCodec.lazyInstance.value) {
          return StatusInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "queuedRuns": value.queuedRuns.toString(),
            "activeRuns": value.activeRuns.toString(),
            "schedulerEnabled": value.schedulerEnabled,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): StatusInfo {
        if (this !== StatusInfo_JsonCodec .lazyInstance.value) {
            return StatusInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new StatusInfo (
            BaboonInt64.read(obj["queuedRuns"], "i64/u64"),
            BaboonInt64.read(obj["activeRuns"], "i64/u64"),
            obj["schedulerEnabled"] as boolean,
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return StatusInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return StatusInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#StatusInfo'
    public baboonTypeIdentifier() {
        return StatusInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new StatusInfo_JsonCodec())
    public static get instance(): StatusInfo_JsonCodec {
        return StatusInfo_JsonCodec.lazyInstance.value
    }
}