import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {OriginContext, OriginContext_JsonCodec} from './OriginContext.js'
import {ReportedInheritance, ReportedInheritance_JsonCodec} from './ReportedInheritance.js'

export class ContextRecord implements BaboonGeneratedLatest {
    private readonly _origin: OriginContext;
    private readonly _reportedInherited: Array<ReportedInheritance>;

    constructor(origin: OriginContext, reportedInherited: Array<ReportedInheritance>) {
        this._origin = origin
        this._reportedInherited = reportedInherited
    }

    public get origin(): OriginContext {
        return this._origin;
    }
    public get reportedInherited(): Array<ReportedInheritance> {
        return this._reportedInherited;
    }

    public toJSON(): Record<string, unknown> {
        return {
            origin: this._origin,
            reportedInherited: this._reportedInherited
        };
    }

    public with(overrides: {origin?: OriginContext; reportedInherited?: Array<ReportedInheritance>}): ContextRecord {
        return new ContextRecord(
            'origin' in overrides ? overrides.origin! : this._origin,
            'reportedInherited' in overrides ? overrides.reportedInherited! : this._reportedInherited
        );
    }

    public static fromPlain(obj: {origin: OriginContext; reportedInherited: Array<ReportedInheritance>}): ContextRecord {
        return new ContextRecord(
            obj.origin,
            obj.reportedInherited
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContextRecord.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContextRecord.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ContextRecord'
    public baboonTypeIdentifier() {
        return ContextRecord.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ContextRecord.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ContextRecord.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ContextRecord.BaboonMinReaderVersions
    }
    public static jsonCodec(): ContextRecord_JsonCodec {
        return ContextRecord_JsonCodec.instance
    }
}

export class ContextRecord_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContextRecord): unknown {
        if (this !== ContextRecord_JsonCodec.lazyInstance.value) {
          return ContextRecord_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "origin": OriginContext_JsonCodec.instance.encode(BaboonCodecContext.Default, value.origin),
            "reportedInherited": Array.from(value.reportedInherited).map(item => ReportedInheritance_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContextRecord {
        if (this !== ContextRecord_JsonCodec .lazyInstance.value) {
            return ContextRecord_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContextRecord (
            OriginContext_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["origin"]),
            (obj["reportedInherited"] as unknown[]).map(item => ReportedInheritance_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContextRecord_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContextRecord_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ContextRecord'
    public baboonTypeIdentifier() {
        return ContextRecord_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContextRecord_JsonCodec())
    public static get instance(): ContextRecord_JsonCodec {
        return ContextRecord_JsonCodec.lazyInstance.value
    }
}