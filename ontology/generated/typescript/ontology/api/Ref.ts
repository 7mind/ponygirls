import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class Ref implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _revision: number;

    constructor(id: string, revision: number) {
        this._id = id
        this._revision = revision
    }

    public get id(): string {
        return this._id;
    }
    public get revision(): number {
        return this._revision;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            revision: this._revision
        };
    }

    public with(overrides: {id?: string; revision?: number}): Ref {
        return new Ref(
            'id' in overrides ? overrides.id! : this._id,
            'revision' in overrides ? overrides.revision! : this._revision
        );
    }

    public static fromPlain(obj: {id: string; revision: number}): Ref {
        return new Ref(
            obj.id,
            obj.revision
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Ref.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Ref.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Ref'
    public baboonTypeIdentifier() {
        return Ref.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Ref.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Ref.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Ref.BaboonMinReaderVersions
    }
    public static jsonCodec(): Ref_JsonCodec {
        return Ref_JsonCodec.instance
    }
}

export class Ref_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Ref): unknown {
        if (this !== Ref_JsonCodec.lazyInstance.value) {
          return Ref_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "revision": value.revision,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Ref {
        if (this !== Ref_JsonCodec .lazyInstance.value) {
            return Ref_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Ref (
            obj["id"] as string,
            obj["revision"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Ref_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Ref_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Ref'
    public baboonTypeIdentifier() {
        return Ref_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Ref_JsonCodec())
    public static get instance(): Ref_JsonCodec {
        return Ref_JsonCodec.lazyInstance.value
    }
}