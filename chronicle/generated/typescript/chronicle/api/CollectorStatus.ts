import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CollectorProgressUpdate, CollectorProgressUpdate_JsonCodec} from './CollectorProgressUpdate.js'

export class CollectorStatus implements BaboonGeneratedLatest {
    private readonly _report: CollectorProgressUpdate;
    private readonly _receivedAt: string;
    private readonly _stale: boolean;

    constructor(report: CollectorProgressUpdate, receivedAt: string, stale: boolean) {
        this._report = report
        this._receivedAt = receivedAt
        this._stale = stale
    }

    public get report(): CollectorProgressUpdate {
        return this._report;
    }
    public get receivedAt(): string {
        return this._receivedAt;
    }
    public get stale(): boolean {
        return this._stale;
    }

    public toJSON(): Record<string, unknown> {
        return {
            report: this._report,
            receivedAt: this._receivedAt,
            stale: this._stale
        };
    }

    public with(overrides: {report?: CollectorProgressUpdate; receivedAt?: string; stale?: boolean}): CollectorStatus {
        return new CollectorStatus(
            'report' in overrides ? overrides.report! : this._report,
            'receivedAt' in overrides ? overrides.receivedAt! : this._receivedAt,
            'stale' in overrides ? overrides.stale! : this._stale
        );
    }

    public static fromPlain(obj: {report: CollectorProgressUpdate; receivedAt: string; stale: boolean}): CollectorStatus {
        return new CollectorStatus(
            obj.report,
            obj.receivedAt,
            obj.stale
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return CollectorStatus.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return CollectorStatus.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#CollectorStatus'
    public baboonTypeIdentifier() {
        return CollectorStatus.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return CollectorStatus.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return CollectorStatus.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return CollectorStatus.BaboonMinReaderVersions
    }
    public static jsonCodec(): CollectorStatus_JsonCodec {
        return CollectorStatus_JsonCodec.instance
    }
}

export class CollectorStatus_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CollectorStatus): unknown {
        if (this !== CollectorStatus_JsonCodec.lazyInstance.value) {
          return CollectorStatus_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "report": CollectorProgressUpdate_JsonCodec.instance.encode(BaboonCodecContext.Default, value.report),
            "receivedAt": value.receivedAt,
            "stale": value.stale,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CollectorStatus {
        if (this !== CollectorStatus_JsonCodec .lazyInstance.value) {
            return CollectorStatus_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CollectorStatus (
            CollectorProgressUpdate_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["report"]),
            obj["receivedAt"] as string,
            obj["stale"] as boolean,
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return CollectorStatus_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return CollectorStatus_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#CollectorStatus'
    public baboonTypeIdentifier() {
        return CollectorStatus_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CollectorStatus_JsonCodec())
    public static get instance(): CollectorStatus_JsonCodec {
        return CollectorStatus_JsonCodec.lazyInstance.value
    }
}