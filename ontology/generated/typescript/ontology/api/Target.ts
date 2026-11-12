import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export type Target = Target_Exact | Target_Created

export const Target = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#Target',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#Target',
    jsonCodec(): Target_JsonCodec {
        return Target_JsonCodec.instance
    }
} as const

export class Target_Exact implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Target]#Exact' as const;
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

    public with(overrides: {ref?: Ref}): Target_Exact {
        return new Target_Exact(
            'ref' in overrides ? overrides.ref! : this._ref
        );
    }

    public static fromPlain(obj: {ref: Ref}): Target_Exact {
        return new Target_Exact(
            obj.ref
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Target_Exact.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Target_Exact.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Target]#Exact'
    public baboonTypeIdentifier() {
        return Target_Exact.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Target_Exact.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Target_Exact.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Target_Exact.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Target'
    public baboonAdtTypeIdentifier() {
        return Target_Exact.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Target_Exact_JsonCodec {
        return Target_Exact_JsonCodec.instance
    }
}

export class Target_Exact_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Target_Exact): unknown {
        if (this !== Target_Exact_JsonCodec.lazyInstance.value) {
          return Target_Exact_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Target_Exact {
        if (this !== Target_Exact_JsonCodec .lazyInstance.value) {
            return Target_Exact_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Target_Exact (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Target_Exact_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Target_Exact_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Target]#Exact'
    public baboonTypeIdentifier() {
        return Target_Exact_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Target'
    public baboonAdtTypeIdentifier() {
        return Target_Exact_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Target_Exact_JsonCodec())
    public static get instance(): Target_Exact_JsonCodec {
        return Target_Exact_JsonCodec.lazyInstance.value
    }
}

export class Target_Created implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Target]#Created' as const;
    private readonly _alias: string;

    constructor(alias: string) {
        this._alias = alias
    }

    public get alias(): string {
        return this._alias;
    }

    public toJSON(): Record<string, unknown> {
        return {
            alias: this._alias
        };
    }

    public with(overrides: {alias?: string}): Target_Created {
        return new Target_Created(
            'alias' in overrides ? overrides.alias! : this._alias
        );
    }

    public static fromPlain(obj: {alias: string}): Target_Created {
        return new Target_Created(
            obj.alias
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Target_Created.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Target_Created.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Target]#Created'
    public baboonTypeIdentifier() {
        return Target_Created.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Target_Created.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Target_Created.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Target_Created.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Target'
    public baboonAdtTypeIdentifier() {
        return Target_Created.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Target_Created_JsonCodec {
        return Target_Created_JsonCodec.instance
    }
}

export class Target_Created_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Target_Created): unknown {
        if (this !== Target_Created_JsonCodec.lazyInstance.value) {
          return Target_Created_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "alias": value.alias,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Target_Created {
        if (this !== Target_Created_JsonCodec .lazyInstance.value) {
            return Target_Created_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Target_Created (
            obj["alias"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Target_Created_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Target_Created_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Target]#Created'
    public baboonTypeIdentifier() {
        return Target_Created_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Target'
    public baboonAdtTypeIdentifier() {
        return Target_Created_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Target_Created_JsonCodec())
    public static get instance(): Target_Created_JsonCodec {
        return Target_Created_JsonCodec.lazyInstance.value
    }
}


export class Target_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Target): unknown {
        if (this !== Target_JsonCodec.lazyInstance.value) {
          return Target_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof Target_Exact) {
                return { "Exact": Target_Exact_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Target_Created) {
                return { "Created": Target_Created_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Target {
        if (this !== Target_JsonCodec .lazyInstance.value) {
            return Target_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Exact": return Target_Exact_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Created": return Target_Created_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Target_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Target_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Target'
    public baboonTypeIdentifier() {
        return Target_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Target'
    public baboonAdtTypeIdentifier() {
        return Target_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Target_JsonCodec())
    public static get instance(): Target_JsonCodec {
        return Target_JsonCodec.lazyInstance.value
    }
}