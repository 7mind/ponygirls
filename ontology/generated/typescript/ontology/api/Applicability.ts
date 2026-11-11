import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ApplicabilityContext, ApplicabilityContext_JsonCodec} from './ApplicabilityContext.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export type Applicability = Applicability_Unresolved | Applicability_Declared | Applicability_Captured

export const Applicability = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#Applicability',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#Applicability',
    jsonCodec(): Applicability_JsonCodec {
        return Applicability_JsonCodec.instance
    }
} as const

export class Applicability_Unresolved implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Applicability]#Unresolved' as const;
    private readonly _reason: string;
    private readonly _basis: Array<Ref>;
    private readonly _context: Array<ApplicabilityContext>;

    constructor(reason: string, basis: Array<Ref>, context: Array<ApplicabilityContext>) {
        this._reason = reason
        this._basis = basis
        this._context = context
    }

    public get reason(): string {
        return this._reason;
    }
    public get basis(): Array<Ref> {
        return this._basis;
    }
    public get context(): Array<ApplicabilityContext> {
        return this._context;
    }

    public toJSON(): Record<string, unknown> {
        return {
            reason: this._reason,
            basis: this._basis,
            context: this._context
        };
    }

    public with(overrides: {reason?: string; basis?: Array<Ref>; context?: Array<ApplicabilityContext>}): Applicability_Unresolved {
        return new Applicability_Unresolved(
            'reason' in overrides ? overrides.reason! : this._reason,
            'basis' in overrides ? overrides.basis! : this._basis,
            'context' in overrides ? overrides.context! : this._context
        );
    }

    public static fromPlain(obj: {reason: string; basis: Array<Ref>; context: Array<ApplicabilityContext>}): Applicability_Unresolved {
        return new Applicability_Unresolved(
            obj.reason,
            obj.basis,
            obj.context
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Applicability_Unresolved.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Applicability_Unresolved.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Applicability]#Unresolved'
    public baboonTypeIdentifier() {
        return Applicability_Unresolved.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Applicability_Unresolved.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Applicability_Unresolved.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Applicability_Unresolved.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Applicability'
    public baboonAdtTypeIdentifier() {
        return Applicability_Unresolved.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Applicability_Unresolved_JsonCodec {
        return Applicability_Unresolved_JsonCodec.instance
    }
}

export class Applicability_Unresolved_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Applicability_Unresolved): unknown {
        if (this !== Applicability_Unresolved_JsonCodec.lazyInstance.value) {
          return Applicability_Unresolved_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "reason": value.reason,
            "basis": Array.from(value.basis).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "context": Array.from(value.context).map(item => ApplicabilityContext_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Applicability_Unresolved {
        if (this !== Applicability_Unresolved_JsonCodec .lazyInstance.value) {
            return Applicability_Unresolved_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Applicability_Unresolved (
            obj["reason"] as string,
            (obj["basis"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["context"] as unknown[]).map(item => ApplicabilityContext_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Applicability_Unresolved_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Applicability_Unresolved_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Applicability]#Unresolved'
    public baboonTypeIdentifier() {
        return Applicability_Unresolved_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Applicability'
    public baboonAdtTypeIdentifier() {
        return Applicability_Unresolved_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Applicability_Unresolved_JsonCodec())
    public static get instance(): Applicability_Unresolved_JsonCodec {
        return Applicability_Unresolved_JsonCodec.lazyInstance.value
    }
}

export class Applicability_Declared implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Applicability]#Declared' as const;
    private readonly _statement: string;
    private readonly _basis: Array<Ref>;
    private readonly _context: Array<ApplicabilityContext>;

    constructor(statement: string, basis: Array<Ref>, context: Array<ApplicabilityContext>) {
        this._statement = statement
        this._basis = basis
        this._context = context
    }

    public get statement(): string {
        return this._statement;
    }
    public get basis(): Array<Ref> {
        return this._basis;
    }
    public get context(): Array<ApplicabilityContext> {
        return this._context;
    }

    public toJSON(): Record<string, unknown> {
        return {
            statement: this._statement,
            basis: this._basis,
            context: this._context
        };
    }

    public with(overrides: {statement?: string; basis?: Array<Ref>; context?: Array<ApplicabilityContext>}): Applicability_Declared {
        return new Applicability_Declared(
            'statement' in overrides ? overrides.statement! : this._statement,
            'basis' in overrides ? overrides.basis! : this._basis,
            'context' in overrides ? overrides.context! : this._context
        );
    }

    public static fromPlain(obj: {statement: string; basis: Array<Ref>; context: Array<ApplicabilityContext>}): Applicability_Declared {
        return new Applicability_Declared(
            obj.statement,
            obj.basis,
            obj.context
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Applicability_Declared.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Applicability_Declared.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Applicability]#Declared'
    public baboonTypeIdentifier() {
        return Applicability_Declared.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Applicability_Declared.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Applicability_Declared.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Applicability_Declared.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Applicability'
    public baboonAdtTypeIdentifier() {
        return Applicability_Declared.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Applicability_Declared_JsonCodec {
        return Applicability_Declared_JsonCodec.instance
    }
}

export class Applicability_Declared_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Applicability_Declared): unknown {
        if (this !== Applicability_Declared_JsonCodec.lazyInstance.value) {
          return Applicability_Declared_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "statement": value.statement,
            "basis": Array.from(value.basis).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "context": Array.from(value.context).map(item => ApplicabilityContext_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Applicability_Declared {
        if (this !== Applicability_Declared_JsonCodec .lazyInstance.value) {
            return Applicability_Declared_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Applicability_Declared (
            obj["statement"] as string,
            (obj["basis"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["context"] as unknown[]).map(item => ApplicabilityContext_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Applicability_Declared_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Applicability_Declared_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Applicability]#Declared'
    public baboonTypeIdentifier() {
        return Applicability_Declared_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Applicability'
    public baboonAdtTypeIdentifier() {
        return Applicability_Declared_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Applicability_Declared_JsonCodec())
    public static get instance(): Applicability_Declared_JsonCodec {
        return Applicability_Declared_JsonCodec.lazyInstance.value
    }
}

export class Applicability_Captured implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Applicability]#Captured' as const;
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

    public with(overrides: {source?: Ref}): Applicability_Captured {
        return new Applicability_Captured(
            'source' in overrides ? overrides.source! : this._source
        );
    }

    public static fromPlain(obj: {source: Ref}): Applicability_Captured {
        return new Applicability_Captured(
            obj.source
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Applicability_Captured.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Applicability_Captured.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Applicability]#Captured'
    public baboonTypeIdentifier() {
        return Applicability_Captured.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Applicability_Captured.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Applicability_Captured.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Applicability_Captured.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Applicability'
    public baboonAdtTypeIdentifier() {
        return Applicability_Captured.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Applicability_Captured_JsonCodec {
        return Applicability_Captured_JsonCodec.instance
    }
}

export class Applicability_Captured_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Applicability_Captured): unknown {
        if (this !== Applicability_Captured_JsonCodec.lazyInstance.value) {
          return Applicability_Captured_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "source": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.source),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Applicability_Captured {
        if (this !== Applicability_Captured_JsonCodec .lazyInstance.value) {
            return Applicability_Captured_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Applicability_Captured (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["source"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Applicability_Captured_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Applicability_Captured_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Applicability]#Captured'
    public baboonTypeIdentifier() {
        return Applicability_Captured_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Applicability'
    public baboonAdtTypeIdentifier() {
        return Applicability_Captured_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Applicability_Captured_JsonCodec())
    public static get instance(): Applicability_Captured_JsonCodec {
        return Applicability_Captured_JsonCodec.lazyInstance.value
    }
}


export class Applicability_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Applicability): unknown {
        if (this !== Applicability_JsonCodec.lazyInstance.value) {
          return Applicability_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof Applicability_Unresolved) {
                return { "Unresolved": Applicability_Unresolved_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Applicability_Declared) {
                return { "Declared": Applicability_Declared_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Applicability_Captured) {
                return { "Captured": Applicability_Captured_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Applicability {
        if (this !== Applicability_JsonCodec .lazyInstance.value) {
            return Applicability_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Unresolved": return Applicability_Unresolved_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Declared": return Applicability_Declared_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Captured": return Applicability_Captured_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Applicability_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Applicability_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Applicability'
    public baboonTypeIdentifier() {
        return Applicability_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Applicability'
    public baboonAdtTypeIdentifier() {
        return Applicability_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Applicability_JsonCodec())
    public static get instance(): Applicability_JsonCodec {
        return Applicability_JsonCodec.lazyInstance.value
    }
}