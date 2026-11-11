import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CaptureContext, CaptureContext_JsonCodec} from './CaptureContext.js'
import {RequestTrace, RequestTrace_JsonCodec} from './RequestTrace.js'

export type OriginContext = OriginContext_Unknown | OriginContext_ReportedNative | OriginContext_ServiceRequest

export const OriginContext = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#OriginContext',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#OriginContext',
    jsonCodec(): OriginContext_JsonCodec {
        return OriginContext_JsonCodec.instance
    }
} as const

export class OriginContext_Unknown implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#OriginContext]#Unknown' as const;
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

    public with(overrides: {reason?: string}): OriginContext_Unknown {
        return new OriginContext_Unknown(
            'reason' in overrides ? overrides.reason! : this._reason
        );
    }

    public static fromPlain(obj: {reason: string}): OriginContext_Unknown {
        return new OriginContext_Unknown(
            obj.reason
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return OriginContext_Unknown.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return OriginContext_Unknown.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#OriginContext]#Unknown'
    public baboonTypeIdentifier() {
        return OriginContext_Unknown.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return OriginContext_Unknown.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return OriginContext_Unknown.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return OriginContext_Unknown.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#OriginContext'
    public baboonAdtTypeIdentifier() {
        return OriginContext_Unknown.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): OriginContext_Unknown_JsonCodec {
        return OriginContext_Unknown_JsonCodec.instance
    }
}

export class OriginContext_Unknown_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: OriginContext_Unknown): unknown {
        if (this !== OriginContext_Unknown_JsonCodec.lazyInstance.value) {
          return OriginContext_Unknown_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "reason": value.reason,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): OriginContext_Unknown {
        if (this !== OriginContext_Unknown_JsonCodec .lazyInstance.value) {
            return OriginContext_Unknown_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new OriginContext_Unknown (
            obj["reason"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return OriginContext_Unknown_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return OriginContext_Unknown_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#OriginContext]#Unknown'
    public baboonTypeIdentifier() {
        return OriginContext_Unknown_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#OriginContext'
    public baboonAdtTypeIdentifier() {
        return OriginContext_Unknown_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new OriginContext_Unknown_JsonCodec())
    public static get instance(): OriginContext_Unknown_JsonCodec {
        return OriginContext_Unknown_JsonCodec.lazyInstance.value
    }
}

export class OriginContext_ReportedNative implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#OriginContext]#ReportedNative' as const;
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

    public with(overrides: {context?: CaptureContext}): OriginContext_ReportedNative {
        return new OriginContext_ReportedNative(
            'context' in overrides ? overrides.context! : this._context
        );
    }

    public static fromPlain(obj: {context: CaptureContext}): OriginContext_ReportedNative {
        return new OriginContext_ReportedNative(
            obj.context
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return OriginContext_ReportedNative.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return OriginContext_ReportedNative.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#OriginContext]#ReportedNative'
    public baboonTypeIdentifier() {
        return OriginContext_ReportedNative.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return OriginContext_ReportedNative.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return OriginContext_ReportedNative.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return OriginContext_ReportedNative.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#OriginContext'
    public baboonAdtTypeIdentifier() {
        return OriginContext_ReportedNative.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): OriginContext_ReportedNative_JsonCodec {
        return OriginContext_ReportedNative_JsonCodec.instance
    }
}

export class OriginContext_ReportedNative_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: OriginContext_ReportedNative): unknown {
        if (this !== OriginContext_ReportedNative_JsonCodec.lazyInstance.value) {
          return OriginContext_ReportedNative_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "context": CaptureContext_JsonCodec.instance.encode(BaboonCodecContext.Default, value.context),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): OriginContext_ReportedNative {
        if (this !== OriginContext_ReportedNative_JsonCodec .lazyInstance.value) {
            return OriginContext_ReportedNative_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new OriginContext_ReportedNative (
            CaptureContext_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["context"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return OriginContext_ReportedNative_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return OriginContext_ReportedNative_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#OriginContext]#ReportedNative'
    public baboonTypeIdentifier() {
        return OriginContext_ReportedNative_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#OriginContext'
    public baboonAdtTypeIdentifier() {
        return OriginContext_ReportedNative_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new OriginContext_ReportedNative_JsonCodec())
    public static get instance(): OriginContext_ReportedNative_JsonCodec {
        return OriginContext_ReportedNative_JsonCodec.lazyInstance.value
    }
}

export class OriginContext_ServiceRequest implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#OriginContext]#ServiceRequest' as const;
    private readonly _trace: RequestTrace;

    constructor(trace: RequestTrace) {
        this._trace = trace
    }

    public get trace(): RequestTrace {
        return this._trace;
    }

    public toJSON(): Record<string, unknown> {
        return {
            trace: this._trace
        };
    }

    public with(overrides: {trace?: RequestTrace}): OriginContext_ServiceRequest {
        return new OriginContext_ServiceRequest(
            'trace' in overrides ? overrides.trace! : this._trace
        );
    }

    public static fromPlain(obj: {trace: RequestTrace}): OriginContext_ServiceRequest {
        return new OriginContext_ServiceRequest(
            obj.trace
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return OriginContext_ServiceRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return OriginContext_ServiceRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#OriginContext]#ServiceRequest'
    public baboonTypeIdentifier() {
        return OriginContext_ServiceRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return OriginContext_ServiceRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return OriginContext_ServiceRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return OriginContext_ServiceRequest.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#OriginContext'
    public baboonAdtTypeIdentifier() {
        return OriginContext_ServiceRequest.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): OriginContext_ServiceRequest_JsonCodec {
        return OriginContext_ServiceRequest_JsonCodec.instance
    }
}

export class OriginContext_ServiceRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: OriginContext_ServiceRequest): unknown {
        if (this !== OriginContext_ServiceRequest_JsonCodec.lazyInstance.value) {
          return OriginContext_ServiceRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "trace": RequestTrace_JsonCodec.instance.encode(BaboonCodecContext.Default, value.trace),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): OriginContext_ServiceRequest {
        if (this !== OriginContext_ServiceRequest_JsonCodec .lazyInstance.value) {
            return OriginContext_ServiceRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new OriginContext_ServiceRequest (
            RequestTrace_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["trace"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return OriginContext_ServiceRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return OriginContext_ServiceRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#OriginContext]#ServiceRequest'
    public baboonTypeIdentifier() {
        return OriginContext_ServiceRequest_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#OriginContext'
    public baboonAdtTypeIdentifier() {
        return OriginContext_ServiceRequest_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new OriginContext_ServiceRequest_JsonCodec())
    public static get instance(): OriginContext_ServiceRequest_JsonCodec {
        return OriginContext_ServiceRequest_JsonCodec.lazyInstance.value
    }
}


export class OriginContext_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: OriginContext): unknown {
        if (this !== OriginContext_JsonCodec.lazyInstance.value) {
          return OriginContext_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof OriginContext_Unknown) {
                return { "Unknown": OriginContext_Unknown_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof OriginContext_ReportedNative) {
                return { "ReportedNative": OriginContext_ReportedNative_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof OriginContext_ServiceRequest) {
                return { "ServiceRequest": OriginContext_ServiceRequest_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): OriginContext {
        if (this !== OriginContext_JsonCodec .lazyInstance.value) {
            return OriginContext_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Unknown": return OriginContext_Unknown_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ReportedNative": return OriginContext_ReportedNative_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ServiceRequest": return OriginContext_ServiceRequest_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return OriginContext_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return OriginContext_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#OriginContext'
    public baboonTypeIdentifier() {
        return OriginContext_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#OriginContext'
    public baboonAdtTypeIdentifier() {
        return OriginContext_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new OriginContext_JsonCodec())
    public static get instance(): OriginContext_JsonCodec {
        return OriginContext_JsonCodec.lazyInstance.value
    }
}