import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Target, Target_JsonCodec} from './Target.js'

export type ApplicabilityContextInput = ApplicabilityContextInput_Capture | ApplicabilityContextInput_Subject

export const ApplicabilityContextInput = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#ApplicabilityContextInput',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#ApplicabilityContextInput',
    jsonCodec(): ApplicabilityContextInput_JsonCodec {
        return ApplicabilityContextInput_JsonCodec.instance
    }
} as const

export class ApplicabilityContextInput_Capture implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ApplicabilityContextInput]#Capture' as const;
    private readonly _source: Target;

    constructor(source: Target) {
        this._source = source
    }

    public get source(): Target {
        return this._source;
    }

    public toJSON(): Record<string, unknown> {
        return {
            source: this._source
        };
    }

    public with(overrides: {source?: Target}): ApplicabilityContextInput_Capture {
        return new ApplicabilityContextInput_Capture(
            'source' in overrides ? overrides.source! : this._source
        );
    }

    public static fromPlain(obj: {source: Target}): ApplicabilityContextInput_Capture {
        return new ApplicabilityContextInput_Capture(
            obj.source
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplicabilityContextInput_Capture.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplicabilityContextInput_Capture.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ApplicabilityContextInput]#Capture'
    public baboonTypeIdentifier() {
        return ApplicabilityContextInput_Capture.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ApplicabilityContextInput_Capture.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ApplicabilityContextInput_Capture.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ApplicabilityContextInput_Capture.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ApplicabilityContextInput'
    public baboonAdtTypeIdentifier() {
        return ApplicabilityContextInput_Capture.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ApplicabilityContextInput_Capture_JsonCodec {
        return ApplicabilityContextInput_Capture_JsonCodec.instance
    }
}

export class ApplicabilityContextInput_Capture_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ApplicabilityContextInput_Capture): unknown {
        if (this !== ApplicabilityContextInput_Capture_JsonCodec.lazyInstance.value) {
          return ApplicabilityContextInput_Capture_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "source": Target_JsonCodec.instance.encode(BaboonCodecContext.Default, value.source),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ApplicabilityContextInput_Capture {
        if (this !== ApplicabilityContextInput_Capture_JsonCodec .lazyInstance.value) {
            return ApplicabilityContextInput_Capture_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ApplicabilityContextInput_Capture (
            Target_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["source"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplicabilityContextInput_Capture_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplicabilityContextInput_Capture_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ApplicabilityContextInput]#Capture'
    public baboonTypeIdentifier() {
        return ApplicabilityContextInput_Capture_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ApplicabilityContextInput'
    public baboonAdtTypeIdentifier() {
        return ApplicabilityContextInput_Capture_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ApplicabilityContextInput_Capture_JsonCodec())
    public static get instance(): ApplicabilityContextInput_Capture_JsonCodec {
        return ApplicabilityContextInput_Capture_JsonCodec.lazyInstance.value
    }
}

export class ApplicabilityContextInput_Subject implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ApplicabilityContextInput]#Subject' as const;
    private readonly _ref: Target;

    constructor(ref: Target) {
        this._ref = ref
    }

    public get ref(): Target {
        return this._ref;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ref: this._ref
        };
    }

    public with(overrides: {ref?: Target}): ApplicabilityContextInput_Subject {
        return new ApplicabilityContextInput_Subject(
            'ref' in overrides ? overrides.ref! : this._ref
        );
    }

    public static fromPlain(obj: {ref: Target}): ApplicabilityContextInput_Subject {
        return new ApplicabilityContextInput_Subject(
            obj.ref
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplicabilityContextInput_Subject.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplicabilityContextInput_Subject.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ApplicabilityContextInput]#Subject'
    public baboonTypeIdentifier() {
        return ApplicabilityContextInput_Subject.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ApplicabilityContextInput_Subject.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ApplicabilityContextInput_Subject.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ApplicabilityContextInput_Subject.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ApplicabilityContextInput'
    public baboonAdtTypeIdentifier() {
        return ApplicabilityContextInput_Subject.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ApplicabilityContextInput_Subject_JsonCodec {
        return ApplicabilityContextInput_Subject_JsonCodec.instance
    }
}

export class ApplicabilityContextInput_Subject_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ApplicabilityContextInput_Subject): unknown {
        if (this !== ApplicabilityContextInput_Subject_JsonCodec.lazyInstance.value) {
          return ApplicabilityContextInput_Subject_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ref": Target_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ApplicabilityContextInput_Subject {
        if (this !== ApplicabilityContextInput_Subject_JsonCodec .lazyInstance.value) {
            return ApplicabilityContextInput_Subject_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ApplicabilityContextInput_Subject (
            Target_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplicabilityContextInput_Subject_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplicabilityContextInput_Subject_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ApplicabilityContextInput]#Subject'
    public baboonTypeIdentifier() {
        return ApplicabilityContextInput_Subject_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ApplicabilityContextInput'
    public baboonAdtTypeIdentifier() {
        return ApplicabilityContextInput_Subject_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ApplicabilityContextInput_Subject_JsonCodec())
    public static get instance(): ApplicabilityContextInput_Subject_JsonCodec {
        return ApplicabilityContextInput_Subject_JsonCodec.lazyInstance.value
    }
}


export class ApplicabilityContextInput_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ApplicabilityContextInput): unknown {
        if (this !== ApplicabilityContextInput_JsonCodec.lazyInstance.value) {
          return ApplicabilityContextInput_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof ApplicabilityContextInput_Capture) {
                return { "Capture": ApplicabilityContextInput_Capture_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ApplicabilityContextInput_Subject) {
                return { "Subject": ApplicabilityContextInput_Subject_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ApplicabilityContextInput {
        if (this !== ApplicabilityContextInput_JsonCodec .lazyInstance.value) {
            return ApplicabilityContextInput_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Capture": return ApplicabilityContextInput_Capture_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Subject": return ApplicabilityContextInput_Subject_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplicabilityContextInput_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplicabilityContextInput_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ApplicabilityContextInput'
    public baboonTypeIdentifier() {
        return ApplicabilityContextInput_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ApplicabilityContextInput'
    public baboonAdtTypeIdentifier() {
        return ApplicabilityContextInput_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ApplicabilityContextInput_JsonCodec())
    public static get instance(): ApplicabilityContextInput_JsonCodec {
        return ApplicabilityContextInput_JsonCodec.lazyInstance.value
    }
}