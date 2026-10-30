import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../../BaboonSharedRuntime.js'
import {CollectorCounters, CollectorCounters_JsonCodec} from './CollectorCounters.js'
import {CollectorPhase, CollectorPhase_JsonCodec} from './CollectorPhase.js'

export class CollectorProgressUpdate implements BaboonGenerated {
    private readonly _collectorId: string;
    private readonly _sequence: bigint;
    private readonly _runId: string;
    private readonly _phase: CollectorPhase;
    private readonly _startedAt: string;
    private readonly _counters: CollectorCounters;
    private readonly _totalUploadBytes: bigint;
    private readonly _uploadedBytes: bigint;
    private readonly _currentUploadTotalBytes: bigint | undefined;
    private readonly _error: string | undefined;

    constructor(collectorId: string, sequence: bigint, runId: string, phase: CollectorPhase, startedAt: string, counters: CollectorCounters, totalUploadBytes: bigint, uploadedBytes: bigint, currentUploadTotalBytes: bigint | undefined, error: string | undefined) {
        this._collectorId = collectorId
        this._sequence = sequence
        this._runId = runId
        this._phase = phase
        this._startedAt = startedAt
        this._counters = counters
        this._totalUploadBytes = totalUploadBytes
        this._uploadedBytes = uploadedBytes
        this._currentUploadTotalBytes = currentUploadTotalBytes
        this._error = error
    }

    public get collectorId(): string {
        return this._collectorId;
    }
    public get sequence(): bigint {
        return this._sequence;
    }
    public get runId(): string {
        return this._runId;
    }
    public get phase(): CollectorPhase {
        return this._phase;
    }
    public get startedAt(): string {
        return this._startedAt;
    }
    public get counters(): CollectorCounters {
        return this._counters;
    }
    public get totalUploadBytes(): bigint {
        return this._totalUploadBytes;
    }
    public get uploadedBytes(): bigint {
        return this._uploadedBytes;
    }
    public get currentUploadTotalBytes(): bigint | undefined {
        return this._currentUploadTotalBytes;
    }
    public get error(): string | undefined {
        return this._error;
    }

    public toJSON(): Record<string, unknown> {
        return {
            collectorId: this._collectorId,
            sequence: this._sequence,
            runId: this._runId,
            phase: this._phase,
            startedAt: this._startedAt,
            counters: this._counters,
            totalUploadBytes: this._totalUploadBytes,
            uploadedBytes: this._uploadedBytes,
            currentUploadTotalBytes: this._currentUploadTotalBytes !== undefined ? this._currentUploadTotalBytes : undefined,
            error: this._error !== undefined ? this._error : undefined
        };
    }

    public with(overrides: {collectorId?: string; sequence?: bigint; runId?: string; phase?: CollectorPhase; startedAt?: string; counters?: CollectorCounters; totalUploadBytes?: bigint; uploadedBytes?: bigint; currentUploadTotalBytes?: bigint | undefined; error?: string | undefined}): CollectorProgressUpdate {
        return new CollectorProgressUpdate(
            'collectorId' in overrides ? overrides.collectorId! : this._collectorId,
            'sequence' in overrides ? overrides.sequence! : this._sequence,
            'runId' in overrides ? overrides.runId! : this._runId,
            'phase' in overrides ? overrides.phase! : this._phase,
            'startedAt' in overrides ? overrides.startedAt! : this._startedAt,
            'counters' in overrides ? overrides.counters! : this._counters,
            'totalUploadBytes' in overrides ? overrides.totalUploadBytes! : this._totalUploadBytes,
            'uploadedBytes' in overrides ? overrides.uploadedBytes! : this._uploadedBytes,
            'currentUploadTotalBytes' in overrides ? overrides.currentUploadTotalBytes! : this._currentUploadTotalBytes,
            'error' in overrides ? overrides.error! : this._error
        );
    }

    public static fromPlain(obj: {collectorId: string; sequence: bigint; runId: string; phase: CollectorPhase; startedAt: string; counters: CollectorCounters; totalUploadBytes: bigint; uploadedBytes: bigint; currentUploadTotalBytes: bigint | undefined; error: string | undefined}): CollectorProgressUpdate {
        return new CollectorProgressUpdate(
            obj.collectorId,
            obj.sequence,
            obj.runId,
            obj.phase,
            obj.startedAt,
            obj.counters,
            obj.totalUploadBytes,
            obj.uploadedBytes,
            obj.currentUploadTotalBytes,
            obj.error
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return CollectorProgressUpdate.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return CollectorProgressUpdate.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#CollectorProgressUpdate'
    public baboonTypeIdentifier() {
        return CollectorProgressUpdate.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return CollectorProgressUpdate.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return CollectorProgressUpdate.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.2.0", "prefix-compact": "1.2.0", "prefix-any-mode": "1.2.0", "identical": "1.2.0" }
    public baboonMinReaderVersions() {
        return CollectorProgressUpdate.BaboonMinReaderVersions
    }
    public static jsonCodec(): CollectorProgressUpdate_JsonCodec {
        return CollectorProgressUpdate_JsonCodec.instance
    }
}

/** @deprecated Version 1.3.0 is deprecated, you should migrate to 1.8.0 */
export class CollectorProgressUpdate_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CollectorProgressUpdate): unknown {
        if (this !== CollectorProgressUpdate_JsonCodec.lazyInstance.value) {
          return CollectorProgressUpdate_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "collectorId": value.collectorId,
            "sequence": value.sequence.toString(),
            "runId": value.runId,
            "phase": CollectorPhase_JsonCodec.instance.encode(BaboonCodecContext.Default, value.phase),
            "startedAt": value.startedAt,
            "counters": CollectorCounters_JsonCodec.instance.encode(BaboonCodecContext.Default, value.counters),
            "totalUploadBytes": value.totalUploadBytes.toString(),
            "uploadedBytes": value.uploadedBytes.toString(),
            "currentUploadTotalBytes": value.currentUploadTotalBytes === undefined ? null : value.currentUploadTotalBytes.toString(),
            "error": value.error === undefined ? null : value.error,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CollectorProgressUpdate {
        if (this !== CollectorProgressUpdate_JsonCodec .lazyInstance.value) {
            return CollectorProgressUpdate_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CollectorProgressUpdate (
            obj["collectorId"] as string,
            BaboonInt64.read(obj["sequence"], "i64/u64"),
            obj["runId"] as string,
            CollectorPhase_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["phase"]),
            obj["startedAt"] as string,
            CollectorCounters_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["counters"]),
            BaboonInt64.read(obj["totalUploadBytes"], "i64/u64"),
            BaboonInt64.read(obj["uploadedBytes"], "i64/u64"),
            obj["currentUploadTotalBytes"] === undefined || obj["currentUploadTotalBytes"] === null ? undefined : obj["currentUploadTotalBytes"] === undefined || obj["currentUploadTotalBytes"] === null ? undefined : BaboonInt64.read(obj["currentUploadTotalBytes"], "i64/u64"),
            obj["error"] === undefined || obj["error"] === null ? undefined : obj["error"] === undefined || obj["error"] === null ? undefined : obj["error"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return CollectorProgressUpdate_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return CollectorProgressUpdate_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#CollectorProgressUpdate'
    public baboonTypeIdentifier() {
        return CollectorProgressUpdate_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CollectorProgressUpdate_JsonCodec())
    public static get instance(): CollectorProgressUpdate_JsonCodec {
        return CollectorProgressUpdate_JsonCodec.lazyInstance.value
    }
}