import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {OriginContextInput, OriginContextInput_JsonCodec} from './OriginContextInput.js'
import {ReportedInheritance, ReportedInheritance_JsonCodec} from './ReportedInheritance.js'

export class ContextRecordInput implements BaboonGeneratedLatest {
    private readonly _origin: OriginContextInput;
    private readonly _reportedInherited: Array<ReportedInheritance>;

    constructor(origin: OriginContextInput, reportedInherited: Array<ReportedInheritance>) {
        this._origin = origin
        this._reportedInherited = reportedInherited
    }

    public get origin(): OriginContextInput {
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

    public with(overrides: {origin?: OriginContextInput; reportedInherited?: Array<ReportedInheritance>}): ContextRecordInput {
        return new ContextRecordInput(
            'origin' in overrides ? overrides.origin! : this._origin,
            'reportedInherited' in overrides ? overrides.reportedInherited! : this._reportedInherited
        );
    }

    public static fromPlain(obj: {origin: OriginContextInput; reportedInherited: Array<ReportedInheritance>}): ContextRecordInput {
        return new ContextRecordInput(
            obj.origin,
            obj.reportedInherited
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContextRecordInput.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContextRecordInput.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ContextRecordInput'
    public baboonTypeIdentifier() {
        return ContextRecordInput.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ContextRecordInput.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ContextRecordInput.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ContextRecordInput.BaboonMinReaderVersions
    }
    public static jsonCodec(): ContextRecordInput_JsonCodec {
        return ContextRecordInput_JsonCodec.instance
    }
}

export class ContextRecordInput_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContextRecordInput): unknown {
        if (this !== ContextRecordInput_JsonCodec.lazyInstance.value) {
          return ContextRecordInput_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "origin": OriginContextInput_JsonCodec.instance.encode(BaboonCodecContext.Default, value.origin),
            "reportedInherited": Array.from(value.reportedInherited).map(item => ReportedInheritance_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContextRecordInput {
        if (this !== ContextRecordInput_JsonCodec .lazyInstance.value) {
            return ContextRecordInput_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContextRecordInput (
            OriginContextInput_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["origin"]),
            (obj["reportedInherited"] as unknown[]).map(item => ReportedInheritance_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ContextRecordInput_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ContextRecordInput_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ContextRecordInput'
    public baboonTypeIdentifier() {
        return ContextRecordInput_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContextRecordInput_JsonCodec())
    public static get instance(): ContextRecordInput_JsonCodec {
        return ContextRecordInput_JsonCodec.lazyInstance.value
    }
}