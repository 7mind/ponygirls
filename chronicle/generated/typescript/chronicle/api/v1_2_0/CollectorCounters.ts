import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../../BaboonSharedRuntime.js'

export class CollectorCounters implements BaboonGenerated {
    private readonly _discovered: number;
    private readonly _scanned: number;
    private readonly _waiting: number;
    private readonly _excluded: number;
    private readonly _unchanged: number;
    private readonly _enqueued: number;
    private readonly _uploaded: number;
    private readonly _uploadFailures: number;
    private readonly _quarantined: number;
    private readonly _pending: number;
    private readonly _stopped: number;
    private readonly _conflicts: number;
    private readonly _scannedBytes: bigint;

    constructor(discovered: number, scanned: number, waiting: number, excluded: number, unchanged: number, enqueued: number, uploaded: number, uploadFailures: number, quarantined: number, pending: number, stopped: number, conflicts: number, scannedBytes: bigint) {
        this._discovered = discovered
        this._scanned = scanned
        this._waiting = waiting
        this._excluded = excluded
        this._unchanged = unchanged
        this._enqueued = enqueued
        this._uploaded = uploaded
        this._uploadFailures = uploadFailures
        this._quarantined = quarantined
        this._pending = pending
        this._stopped = stopped
        this._conflicts = conflicts
        this._scannedBytes = scannedBytes
    }

    public get discovered(): number {
        return this._discovered;
    }
    public get scanned(): number {
        return this._scanned;
    }
    public get waiting(): number {
        return this._waiting;
    }
    public get excluded(): number {
        return this._excluded;
    }
    public get unchanged(): number {
        return this._unchanged;
    }
    public get enqueued(): number {
        return this._enqueued;
    }
    public get uploaded(): number {
        return this._uploaded;
    }
    public get uploadFailures(): number {
        return this._uploadFailures;
    }
    public get quarantined(): number {
        return this._quarantined;
    }
    public get pending(): number {
        return this._pending;
    }
    public get stopped(): number {
        return this._stopped;
    }
    public get conflicts(): number {
        return this._conflicts;
    }
    public get scannedBytes(): bigint {
        return this._scannedBytes;
    }

    public toJSON(): Record<string, unknown> {
        return {
            discovered: this._discovered,
            scanned: this._scanned,
            waiting: this._waiting,
            excluded: this._excluded,
            unchanged: this._unchanged,
            enqueued: this._enqueued,
            uploaded: this._uploaded,
            uploadFailures: this._uploadFailures,
            quarantined: this._quarantined,
            pending: this._pending,
            stopped: this._stopped,
            conflicts: this._conflicts,
            scannedBytes: this._scannedBytes
        };
    }

    public with(overrides: {discovered?: number; scanned?: number; waiting?: number; excluded?: number; unchanged?: number; enqueued?: number; uploaded?: number; uploadFailures?: number; quarantined?: number; pending?: number; stopped?: number; conflicts?: number; scannedBytes?: bigint}): CollectorCounters {
        return new CollectorCounters(
            'discovered' in overrides ? overrides.discovered! : this._discovered,
            'scanned' in overrides ? overrides.scanned! : this._scanned,
            'waiting' in overrides ? overrides.waiting! : this._waiting,
            'excluded' in overrides ? overrides.excluded! : this._excluded,
            'unchanged' in overrides ? overrides.unchanged! : this._unchanged,
            'enqueued' in overrides ? overrides.enqueued! : this._enqueued,
            'uploaded' in overrides ? overrides.uploaded! : this._uploaded,
            'uploadFailures' in overrides ? overrides.uploadFailures! : this._uploadFailures,
            'quarantined' in overrides ? overrides.quarantined! : this._quarantined,
            'pending' in overrides ? overrides.pending! : this._pending,
            'stopped' in overrides ? overrides.stopped! : this._stopped,
            'conflicts' in overrides ? overrides.conflicts! : this._conflicts,
            'scannedBytes' in overrides ? overrides.scannedBytes! : this._scannedBytes
        );
    }

    public static fromPlain(obj: {discovered: number; scanned: number; waiting: number; excluded: number; unchanged: number; enqueued: number; uploaded: number; uploadFailures: number; quarantined: number; pending: number; stopped: number; conflicts: number; scannedBytes: bigint}): CollectorCounters {
        return new CollectorCounters(
            obj.discovered,
            obj.scanned,
            obj.waiting,
            obj.excluded,
            obj.unchanged,
            obj.enqueued,
            obj.uploaded,
            obj.uploadFailures,
            obj.quarantined,
            obj.pending,
            obj.stopped,
            obj.conflicts,
            obj.scannedBytes
        );
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return CollectorCounters.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return CollectorCounters.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#CollectorCounters'
    public baboonTypeIdentifier() {
        return CollectorCounters.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return CollectorCounters.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.2.0": "identical", "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return CollectorCounters.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.2.0", "prefix-compact": "1.2.0", "prefix-any-mode": "1.2.0", "identical": "1.2.0" }
    public baboonMinReaderVersions() {
        return CollectorCounters.BaboonMinReaderVersions
    }
    public static jsonCodec(): CollectorCounters_JsonCodec {
        return CollectorCounters_JsonCodec.instance
    }
}

/** @deprecated Version 1.2.0 is deprecated, you should migrate to 1.7.0 */
export class CollectorCounters_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CollectorCounters): unknown {
        if (this !== CollectorCounters_JsonCodec.lazyInstance.value) {
          return CollectorCounters_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "discovered": value.discovered,
            "scanned": value.scanned,
            "waiting": value.waiting,
            "excluded": value.excluded,
            "unchanged": value.unchanged,
            "enqueued": value.enqueued,
            "uploaded": value.uploaded,
            "uploadFailures": value.uploadFailures,
            "quarantined": value.quarantined,
            "pending": value.pending,
            "stopped": value.stopped,
            "conflicts": value.conflicts,
            "scannedBytes": value.scannedBytes.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CollectorCounters {
        if (this !== CollectorCounters_JsonCodec .lazyInstance.value) {
            return CollectorCounters_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CollectorCounters (
            obj["discovered"] as number,
            obj["scanned"] as number,
            obj["waiting"] as number,
            obj["excluded"] as number,
            obj["unchanged"] as number,
            obj["enqueued"] as number,
            obj["uploaded"] as number,
            obj["uploadFailures"] as number,
            obj["quarantined"] as number,
            obj["pending"] as number,
            obj["stopped"] as number,
            obj["conflicts"] as number,
            BaboonInt64.read(obj["scannedBytes"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return CollectorCounters_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return CollectorCounters_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#CollectorCounters'
    public baboonTypeIdentifier() {
        return CollectorCounters_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CollectorCounters_JsonCodec())
    public static get instance(): CollectorCounters_JsonCodec {
        return CollectorCounters_JsonCodec.lazyInstance.value
    }
}