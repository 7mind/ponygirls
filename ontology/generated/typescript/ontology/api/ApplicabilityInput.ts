import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ApplicabilityContextInput, ApplicabilityContextInput_JsonCodec} from './ApplicabilityContextInput.js'
import {Target, Target_JsonCodec} from './Target.js'

export type ApplicabilityInput = ApplicabilityInput_Unresolved | ApplicabilityInput_Declared

export const ApplicabilityInput = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#ApplicabilityInput',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#ApplicabilityInput',
    jsonCodec(): ApplicabilityInput_JsonCodec {
        return ApplicabilityInput_JsonCodec.instance
    }
} as const

export class ApplicabilityInput_Unresolved implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ApplicabilityInput]#Unresolved' as const;
    private readonly _reason: string;
    private readonly _basis: Array<Target>;
    private readonly _context: Array<ApplicabilityContextInput>;

    constructor(reason: string, basis: Array<Target>, context: Array<ApplicabilityContextInput>) {
        this._reason = reason
        this._basis = basis
        this._context = context
    }

    public get reason(): string {
        return this._reason;
    }
    public get basis(): Array<Target> {
        return this._basis;
    }
    public get context(): Array<ApplicabilityContextInput> {
        return this._context;
    }

    public toJSON(): Record<string, unknown> {
        return {
            reason: this._reason,
            basis: this._basis,
            context: this._context
        };
    }

    public with(overrides: {reason?: string; basis?: Array<Target>; context?: Array<ApplicabilityContextInput>}): ApplicabilityInput_Unresolved {
        return new ApplicabilityInput_Unresolved(
            'reason' in overrides ? overrides.reason! : this._reason,
            'basis' in overrides ? overrides.basis! : this._basis,
            'context' in overrides ? overrides.context! : this._context
        );
    }

    public static fromPlain(obj: {reason: string; basis: Array<Target>; context: Array<ApplicabilityContextInput>}): ApplicabilityInput_Unresolved {
        return new ApplicabilityInput_Unresolved(
            obj.reason,
            obj.basis,
            obj.context
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplicabilityInput_Unresolved.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplicabilityInput_Unresolved.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ApplicabilityInput]#Unresolved'
    public baboonTypeIdentifier() {
        return ApplicabilityInput_Unresolved.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ApplicabilityInput_Unresolved.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ApplicabilityInput_Unresolved.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ApplicabilityInput_Unresolved.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ApplicabilityInput'
    public baboonAdtTypeIdentifier() {
        return ApplicabilityInput_Unresolved.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ApplicabilityInput_Unresolved_JsonCodec {
        return ApplicabilityInput_Unresolved_JsonCodec.instance
    }
}

export class ApplicabilityInput_Unresolved_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ApplicabilityInput_Unresolved): unknown {
        if (this !== ApplicabilityInput_Unresolved_JsonCodec.lazyInstance.value) {
          return ApplicabilityInput_Unresolved_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "reason": value.reason,
            "basis": Array.from(value.basis).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "context": Array.from(value.context).map(item => ApplicabilityContextInput_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ApplicabilityInput_Unresolved {
        if (this !== ApplicabilityInput_Unresolved_JsonCodec .lazyInstance.value) {
            return ApplicabilityInput_Unresolved_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ApplicabilityInput_Unresolved (
            obj["reason"] as string,
            (obj["basis"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["context"] as unknown[]).map(item => ApplicabilityContextInput_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplicabilityInput_Unresolved_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplicabilityInput_Unresolved_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ApplicabilityInput]#Unresolved'
    public baboonTypeIdentifier() {
        return ApplicabilityInput_Unresolved_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ApplicabilityInput'
    public baboonAdtTypeIdentifier() {
        return ApplicabilityInput_Unresolved_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ApplicabilityInput_Unresolved_JsonCodec())
    public static get instance(): ApplicabilityInput_Unresolved_JsonCodec {
        return ApplicabilityInput_Unresolved_JsonCodec.lazyInstance.value
    }
}

export class ApplicabilityInput_Declared implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#ApplicabilityInput]#Declared' as const;
    private readonly _statement: string;
    private readonly _basis: Array<Target>;
    private readonly _context: Array<ApplicabilityContextInput>;

    constructor(statement: string, basis: Array<Target>, context: Array<ApplicabilityContextInput>) {
        this._statement = statement
        this._basis = basis
        this._context = context
    }

    public get statement(): string {
        return this._statement;
    }
    public get basis(): Array<Target> {
        return this._basis;
    }
    public get context(): Array<ApplicabilityContextInput> {
        return this._context;
    }

    public toJSON(): Record<string, unknown> {
        return {
            statement: this._statement,
            basis: this._basis,
            context: this._context
        };
    }

    public with(overrides: {statement?: string; basis?: Array<Target>; context?: Array<ApplicabilityContextInput>}): ApplicabilityInput_Declared {
        return new ApplicabilityInput_Declared(
            'statement' in overrides ? overrides.statement! : this._statement,
            'basis' in overrides ? overrides.basis! : this._basis,
            'context' in overrides ? overrides.context! : this._context
        );
    }

    public static fromPlain(obj: {statement: string; basis: Array<Target>; context: Array<ApplicabilityContextInput>}): ApplicabilityInput_Declared {
        return new ApplicabilityInput_Declared(
            obj.statement,
            obj.basis,
            obj.context
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplicabilityInput_Declared.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplicabilityInput_Declared.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ApplicabilityInput]#Declared'
    public baboonTypeIdentifier() {
        return ApplicabilityInput_Declared.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ApplicabilityInput_Declared.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ApplicabilityInput_Declared.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ApplicabilityInput_Declared.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ApplicabilityInput'
    public baboonAdtTypeIdentifier() {
        return ApplicabilityInput_Declared.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ApplicabilityInput_Declared_JsonCodec {
        return ApplicabilityInput_Declared_JsonCodec.instance
    }
}

export class ApplicabilityInput_Declared_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ApplicabilityInput_Declared): unknown {
        if (this !== ApplicabilityInput_Declared_JsonCodec.lazyInstance.value) {
          return ApplicabilityInput_Declared_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "statement": value.statement,
            "basis": Array.from(value.basis).map(item => Target_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "context": Array.from(value.context).map(item => ApplicabilityContextInput_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ApplicabilityInput_Declared {
        if (this !== ApplicabilityInput_Declared_JsonCodec .lazyInstance.value) {
            return ApplicabilityInput_Declared_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ApplicabilityInput_Declared (
            obj["statement"] as string,
            (obj["basis"] as unknown[]).map(item => Target_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["context"] as unknown[]).map(item => ApplicabilityContextInput_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplicabilityInput_Declared_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplicabilityInput_Declared_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#ApplicabilityInput]#Declared'
    public baboonTypeIdentifier() {
        return ApplicabilityInput_Declared_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ApplicabilityInput'
    public baboonAdtTypeIdentifier() {
        return ApplicabilityInput_Declared_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ApplicabilityInput_Declared_JsonCodec())
    public static get instance(): ApplicabilityInput_Declared_JsonCodec {
        return ApplicabilityInput_Declared_JsonCodec.lazyInstance.value
    }
}


export class ApplicabilityInput_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ApplicabilityInput): unknown {
        if (this !== ApplicabilityInput_JsonCodec.lazyInstance.value) {
          return ApplicabilityInput_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof ApplicabilityInput_Unresolved) {
                return { "Unresolved": ApplicabilityInput_Unresolved_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ApplicabilityInput_Declared) {
                return { "Declared": ApplicabilityInput_Declared_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ApplicabilityInput {
        if (this !== ApplicabilityInput_JsonCodec .lazyInstance.value) {
            return ApplicabilityInput_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Unresolved": return ApplicabilityInput_Unresolved_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Declared": return ApplicabilityInput_Declared_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ApplicabilityInput_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ApplicabilityInput_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ApplicabilityInput'
    public baboonTypeIdentifier() {
        return ApplicabilityInput_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#ApplicabilityInput'
    public baboonAdtTypeIdentifier() {
        return ApplicabilityInput_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ApplicabilityInput_JsonCodec())
    public static get instance(): ApplicabilityInput_JsonCodec {
        return ApplicabilityInput_JsonCodec.lazyInstance.value
    }
}