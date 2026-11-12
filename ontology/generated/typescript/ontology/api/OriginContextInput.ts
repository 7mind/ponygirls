import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CaptureContext, CaptureContext_JsonCodec} from './CaptureContext.js'

export type OriginContextInput = OriginContextInput_Unknown | OriginContextInput_ReportedNative

export const OriginContextInput = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#OriginContextInput',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#OriginContextInput',
    jsonCodec(): OriginContextInput_JsonCodec {
        return OriginContextInput_JsonCodec.instance
    }
} as const

export class OriginContextInput_Unknown implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#OriginContextInput]#Unknown' as const;
    private readonly _reason: string;

    constructor(reason: string) {
        this._reason = reason
    }

    public get reason(): string {
        return this._reason;
    }

    public toJSON(): Record<string, unknown> {
        return {
            reason: this._reason
        };
    }

    public with(overrides: {reason?: string}): OriginContextInput_Unknown {
        return new OriginContextInput_Unknown(
            'reason' in overrides ? overrides.reason! : this._reason
        );
    }

    public static fromPlain(obj: {reason: string}): OriginContextInput_Unknown {
        return new OriginContextInput_Unknown(
            obj.reason
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return OriginContextInput_Unknown.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return OriginContextInput_Unknown.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#OriginContextInput]#Unknown'
    public baboonTypeIdentifier() {
        return OriginContextInput_Unknown.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return OriginContextInput_Unknown.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return OriginContextInput_Unknown.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return OriginContextInput_Unknown.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#OriginContextInput'
    public baboonAdtTypeIdentifier() {
        return OriginContextInput_Unknown.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): OriginContextInput_Unknown_JsonCodec {
        return OriginContextInput_Unknown_JsonCodec.instance
    }
}

export class OriginContextInput_Unknown_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: OriginContextInput_Unknown): unknown {
        if (this !== OriginContextInput_Unknown_JsonCodec.lazyInstance.value) {
          return OriginContextInput_Unknown_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "reason": value.reason,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): OriginContextInput_Unknown {
        if (this !== OriginContextInput_Unknown_JsonCodec .lazyInstance.value) {
            return OriginContextInput_Unknown_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new OriginContextInput_Unknown (
            obj["reason"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return OriginContextInput_Unknown_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return OriginContextInput_Unknown_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#OriginContextInput]#Unknown'
    public baboonTypeIdentifier() {
        return OriginContextInput_Unknown_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#OriginContextInput'
    public baboonAdtTypeIdentifier() {
        return OriginContextInput_Unknown_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new OriginContextInput_Unknown_JsonCodec())
    public static get instance(): OriginContextInput_Unknown_JsonCodec {
        return OriginContextInput_Unknown_JsonCodec.lazyInstance.value
    }
}

export class OriginContextInput_ReportedNative implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#OriginContextInput]#ReportedNative' as const;
    private readonly _context: CaptureContext;

    constructor(context: CaptureContext) {
        this._context = context
    }

    public get context(): CaptureContext {
        return this._context;
    }

    public toJSON(): Record<string, unknown> {
        return {
            context: this._context
        };
    }

    public with(overrides: {context?: CaptureContext}): OriginContextInput_ReportedNative {
        return new OriginContextInput_ReportedNative(
            'context' in overrides ? overrides.context! : this._context
        );
    }

    public static fromPlain(obj: {context: CaptureContext}): OriginContextInput_ReportedNative {
        return new OriginContextInput_ReportedNative(
            obj.context
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return OriginContextInput_ReportedNative.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return OriginContextInput_ReportedNative.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#OriginContextInput]#ReportedNative'
    public baboonTypeIdentifier() {
        return OriginContextInput_ReportedNative.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return OriginContextInput_ReportedNative.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return OriginContextInput_ReportedNative.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return OriginContextInput_ReportedNative.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#OriginContextInput'
    public baboonAdtTypeIdentifier() {
        return OriginContextInput_ReportedNative.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): OriginContextInput_ReportedNative_JsonCodec {
        return OriginContextInput_ReportedNative_JsonCodec.instance
    }
}

export class OriginContextInput_ReportedNative_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: OriginContextInput_ReportedNative): unknown {
        if (this !== OriginContextInput_ReportedNative_JsonCodec.lazyInstance.value) {
          return OriginContextInput_ReportedNative_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "context": CaptureContext_JsonCodec.instance.encode(BaboonCodecContext.Default, value.context),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): OriginContextInput_ReportedNative {
        if (this !== OriginContextInput_ReportedNative_JsonCodec .lazyInstance.value) {
            return OriginContextInput_ReportedNative_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new OriginContextInput_ReportedNative (
            CaptureContext_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["context"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return OriginContextInput_ReportedNative_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return OriginContextInput_ReportedNative_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#OriginContextInput]#ReportedNative'
    public baboonTypeIdentifier() {
        return OriginContextInput_ReportedNative_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#OriginContextInput'
    public baboonAdtTypeIdentifier() {
        return OriginContextInput_ReportedNative_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new OriginContextInput_ReportedNative_JsonCodec())
    public static get instance(): OriginContextInput_ReportedNative_JsonCodec {
        return OriginContextInput_ReportedNative_JsonCodec.lazyInstance.value
    }
}


export class OriginContextInput_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: OriginContextInput): unknown {
        if (this !== OriginContextInput_JsonCodec.lazyInstance.value) {
          return OriginContextInput_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof OriginContextInput_Unknown) {
                return { "Unknown": OriginContextInput_Unknown_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof OriginContextInput_ReportedNative) {
                return { "ReportedNative": OriginContextInput_ReportedNative_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): OriginContextInput {
        if (this !== OriginContextInput_JsonCodec .lazyInstance.value) {
            return OriginContextInput_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Unknown": return OriginContextInput_Unknown_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ReportedNative": return OriginContextInput_ReportedNative_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return OriginContextInput_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return OriginContextInput_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#OriginContextInput'
    public baboonTypeIdentifier() {
        return OriginContextInput_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#OriginContextInput'
    public baboonAdtTypeIdentifier() {
        return OriginContextInput_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new OriginContextInput_JsonCodec())
    public static get instance(): OriginContextInput_JsonCodec {
        return OriginContextInput_JsonCodec.lazyInstance.value
    }
}