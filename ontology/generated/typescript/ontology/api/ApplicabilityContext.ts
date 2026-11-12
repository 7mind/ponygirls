import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export type ApplicabilityContext = ApplicabilityContext_Capture | ApplicabilityContext_Subject

export const ApplicabilityContext = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#ApplicabilityContext',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#ApplicabilityContext',
    jsonCodec(): ApplicabilityContext_JsonCodec {
        return ApplicabilityContext_JsonCodec.instance
    }
} as const

export class ApplicabilityContext_Capture implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ApplicabilityContext]#Capture' as const;
    private readonly _source: Ref;

    constructor(source: Ref) {
        this._source = source
    }

    public get source(): Ref {
        return this._source;
    }

    public toJSON(): Record<string, unknown> {
        return {
            source: this._source
        };
    }

    public with(overrides: {source?: Ref}): ApplicabilityContext_Capture {
        return new ApplicabilityContext_Capture(
            'source' in overrides ? overrides.source! : this._source
        );
    }

    public static fromPlain(obj: {source: Ref}): ApplicabilityContext_Capture {
        return new ApplicabilityContext_Capture(
            obj.source
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplicabilityContext_Capture.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplicabilityContext_Capture.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ApplicabilityContext]#Capture'
    public baboonTypeIdentifier() {
        return ApplicabilityContext_Capture.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ApplicabilityContext_Capture.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ApplicabilityContext_Capture.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ApplicabilityContext_Capture.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ApplicabilityContext'
    public baboonAdtTypeIdentifier() {
        return ApplicabilityContext_Capture.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ApplicabilityContext_Capture_JsonCodec {
        return ApplicabilityContext_Capture_JsonCodec.instance
    }
}

export class ApplicabilityContext_Capture_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ApplicabilityContext_Capture): unknown {
        if (this !== ApplicabilityContext_Capture_JsonCodec.lazyInstance.value) {
          return ApplicabilityContext_Capture_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "source": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.source),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ApplicabilityContext_Capture {
        if (this !== ApplicabilityContext_Capture_JsonCodec .lazyInstance.value) {
            return ApplicabilityContext_Capture_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ApplicabilityContext_Capture (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["source"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplicabilityContext_Capture_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplicabilityContext_Capture_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ApplicabilityContext]#Capture'
    public baboonTypeIdentifier() {
        return ApplicabilityContext_Capture_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ApplicabilityContext'
    public baboonAdtTypeIdentifier() {
        return ApplicabilityContext_Capture_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ApplicabilityContext_Capture_JsonCodec())
    public static get instance(): ApplicabilityContext_Capture_JsonCodec {
        return ApplicabilityContext_Capture_JsonCodec.lazyInstance.value
    }
}

export class ApplicabilityContext_Subject implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ApplicabilityContext]#Subject' as const;
    private readonly _ref: Ref;

    constructor(ref: Ref) {
        this._ref = ref
    }

    public get ref(): Ref {
        return this._ref;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ref: this._ref
        };
    }

    public with(overrides: {ref?: Ref}): ApplicabilityContext_Subject {
        return new ApplicabilityContext_Subject(
            'ref' in overrides ? overrides.ref! : this._ref
        );
    }

    public static fromPlain(obj: {ref: Ref}): ApplicabilityContext_Subject {
        return new ApplicabilityContext_Subject(
            obj.ref
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplicabilityContext_Subject.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplicabilityContext_Subject.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ApplicabilityContext]#Subject'
    public baboonTypeIdentifier() {
        return ApplicabilityContext_Subject.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ApplicabilityContext_Subject.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ApplicabilityContext_Subject.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ApplicabilityContext_Subject.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ApplicabilityContext'
    public baboonAdtTypeIdentifier() {
        return ApplicabilityContext_Subject.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ApplicabilityContext_Subject_JsonCodec {
        return ApplicabilityContext_Subject_JsonCodec.instance
    }
}

export class ApplicabilityContext_Subject_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ApplicabilityContext_Subject): unknown {
        if (this !== ApplicabilityContext_Subject_JsonCodec.lazyInstance.value) {
          return ApplicabilityContext_Subject_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ApplicabilityContext_Subject {
        if (this !== ApplicabilityContext_Subject_JsonCodec .lazyInstance.value) {
            return ApplicabilityContext_Subject_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ApplicabilityContext_Subject (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplicabilityContext_Subject_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplicabilityContext_Subject_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ApplicabilityContext]#Subject'
    public baboonTypeIdentifier() {
        return ApplicabilityContext_Subject_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ApplicabilityContext'
    public baboonAdtTypeIdentifier() {
        return ApplicabilityContext_Subject_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ApplicabilityContext_Subject_JsonCodec())
    public static get instance(): ApplicabilityContext_Subject_JsonCodec {
        return ApplicabilityContext_Subject_JsonCodec.lazyInstance.value
    }
}


export class ApplicabilityContext_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ApplicabilityContext): unknown {
        if (this !== ApplicabilityContext_JsonCodec.lazyInstance.value) {
          return ApplicabilityContext_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof ApplicabilityContext_Capture) {
                return { "Capture": ApplicabilityContext_Capture_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ApplicabilityContext_Subject) {
                return { "Subject": ApplicabilityContext_Subject_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ApplicabilityContext {
        if (this !== ApplicabilityContext_JsonCodec .lazyInstance.value) {
            return ApplicabilityContext_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Capture": return ApplicabilityContext_Capture_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Subject": return ApplicabilityContext_Subject_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplicabilityContext_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplicabilityContext_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ApplicabilityContext'
    public baboonTypeIdentifier() {
        return ApplicabilityContext_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ApplicabilityContext'
    public baboonAdtTypeIdentifier() {
        return ApplicabilityContext_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ApplicabilityContext_JsonCodec())
    public static get instance(): ApplicabilityContext_JsonCodec {
        return ApplicabilityContext_JsonCodec.lazyInstance.value
    }
}