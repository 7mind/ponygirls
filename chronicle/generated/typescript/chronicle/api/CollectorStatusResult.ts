import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CollectorStatus, CollectorStatus_JsonCodec} from './CollectorStatus.js'

export class CollectorStatusResult implements BaboonGeneratedLatest {
    private readonly _collectors: Array<CollectorStatus>;

    constructor(collectors: Array<CollectorStatus>) {
        this._collectors = collectors
    }

    public get collectors(): Array<CollectorStatus> {
        return this._collectors;
    }

    public toJSON(): Record<string, unknown> {
        return {
            collectors: this._collectors
        };
    }

    public with(overrides: {collectors?: Array<CollectorStatus>}): CollectorStatusResult {
        return new CollectorStatusResult(
            'collectors' in overrides ? overrides.collectors! : this._collectors
        );
    }

    public static fromPlain(obj: {collectors: Array<CollectorStatus>}): CollectorStatusResult {
        return new CollectorStatusResult(
            obj.collectors
        );
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return CollectorStatusResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return CollectorStatusResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#CollectorStatusResult'
    public baboonTypeIdentifier() {
        return CollectorStatusResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.2.0", "1.3.0", "1.4.0", "1.5.0"]
    public baboonSameInVersions() {
        return CollectorStatusResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.5.0": "identical" }
    public baboonForwardReadable() {
        return CollectorStatusResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.2.0", "prefix-compact": "1.2.0", "prefix-any-mode": "1.2.0", "identical": "1.2.0" }
    public baboonMinReaderVersions() {
        return CollectorStatusResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): CollectorStatusResult_JsonCodec {
        return CollectorStatusResult_JsonCodec.instance
    }
}

export class CollectorStatusResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CollectorStatusResult): unknown {
        if (this !== CollectorStatusResult_JsonCodec.lazyInstance.value) {
          return CollectorStatusResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "collectors": Array.from(value.collectors).map(item => CollectorStatus_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CollectorStatusResult {
        if (this !== CollectorStatusResult_JsonCodec .lazyInstance.value) {
            return CollectorStatusResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CollectorStatusResult (
            (obj["collectors"] as unknown[]).map(item => CollectorStatus_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return CollectorStatusResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return CollectorStatusResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#CollectorStatusResult'
    public baboonTypeIdentifier() {
        return CollectorStatusResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CollectorStatusResult_JsonCodec())
    public static get instance(): CollectorStatusResult_JsonCodec {
        return CollectorStatusResult_JsonCodec.lazyInstance.value
    }
}