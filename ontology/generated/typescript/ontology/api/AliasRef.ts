import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class AliasRef implements BaboonGeneratedLatest {
    private readonly _alias: string;
    private readonly _ref: Ref;

    constructor(alias: string, ref: Ref) {
        this._alias = alias
        this._ref = ref
    }

    public get alias(): string {
        return this._alias;
    }
    public get ref(): Ref {
        return this._ref;
    }

    public toJSON(): Record<string, unknown> {
        return {
            alias: this._alias,
            ref: this._ref
        };
    }

    public with(overrides: {alias?: string; ref?: Ref}): AliasRef {
        return new AliasRef(
            'alias' in overrides ? overrides.alias! : this._alias,
            'ref' in overrides ? overrides.ref! : this._ref
        );
    }

    public static fromPlain(obj: {alias: string; ref: Ref}): AliasRef {
        return new AliasRef(
            obj.alias,
            obj.ref
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return AliasRef.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return AliasRef.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#AliasRef'
    public baboonTypeIdentifier() {
        return AliasRef.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return AliasRef.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return AliasRef.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return AliasRef.BaboonMinReaderVersions
    }
    public static jsonCodec(): AliasRef_JsonCodec {
        return AliasRef_JsonCodec.instance
    }
}

export class AliasRef_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: AliasRef): unknown {
        if (this !== AliasRef_JsonCodec.lazyInstance.value) {
          return AliasRef_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "alias": value.alias,
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): AliasRef {
        if (this !== AliasRef_JsonCodec .lazyInstance.value) {
            return AliasRef_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new AliasRef (
            obj["alias"] as string,
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return AliasRef_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return AliasRef_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#AliasRef'
    public baboonTypeIdentifier() {
        return AliasRef_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new AliasRef_JsonCodec())
    public static get instance(): AliasRef_JsonCodec {
        return AliasRef_JsonCodec.lazyInstance.value
    }
}