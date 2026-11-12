import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class CapsulePolicyIdentity implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _digest: string;

    constructor(id: string, digest: string) {
        this._id = id
        this._digest = digest
    }

    public get id(): string {
        return this._id;
    }
    public get digest(): string {
        return this._digest;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            digest: this._digest
        };
    }

    public with(overrides: {id?: string; digest?: string}): CapsulePolicyIdentity {
        return new CapsulePolicyIdentity(
            'id' in overrides ? overrides.id! : this._id,
            'digest' in overrides ? overrides.digest! : this._digest
        );
    }

    public static fromPlain(obj: {id: string; digest: string}): CapsulePolicyIdentity {
        return new CapsulePolicyIdentity(
            obj.id,
            obj.digest
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsulePolicyIdentity.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsulePolicyIdentity.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsulePolicyIdentity'
    public baboonTypeIdentifier() {
        return CapsulePolicyIdentity.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CapsulePolicyIdentity.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CapsulePolicyIdentity.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CapsulePolicyIdentity.BaboonMinReaderVersions
    }
    public static jsonCodec(): CapsulePolicyIdentity_JsonCodec {
        return CapsulePolicyIdentity_JsonCodec.instance
    }
}

export class CapsulePolicyIdentity_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CapsulePolicyIdentity): unknown {
        if (this !== CapsulePolicyIdentity_JsonCodec.lazyInstance.value) {
          return CapsulePolicyIdentity_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "digest": value.digest,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CapsulePolicyIdentity {
        if (this !== CapsulePolicyIdentity_JsonCodec .lazyInstance.value) {
            return CapsulePolicyIdentity_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CapsulePolicyIdentity (
            obj["id"] as string,
            obj["digest"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsulePolicyIdentity_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsulePolicyIdentity_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsulePolicyIdentity'
    public baboonTypeIdentifier() {
        return CapsulePolicyIdentity_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CapsulePolicyIdentity_JsonCodec())
    public static get instance(): CapsulePolicyIdentity_JsonCodec {
        return CapsulePolicyIdentity_JsonCodec.lazyInstance.value
    }
}