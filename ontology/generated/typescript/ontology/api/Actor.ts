import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ActorKind, ActorKind_JsonCodec} from './ActorKind.js'

export class Actor implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _kind: ActorKind;

    constructor(id: string, kind: ActorKind) {
        this._id = id
        this._kind = kind
    }

    public get id(): string {
        return this._id;
    }
    public get kind(): ActorKind {
        return this._kind;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            kind: this._kind
        };
    }

    public with(overrides: {id?: string; kind?: ActorKind}): Actor {
        return new Actor(
            'id' in overrides ? overrides.id! : this._id,
            'kind' in overrides ? overrides.kind! : this._kind
        );
    }

    public static fromPlain(obj: {id: string; kind: ActorKind}): Actor {
        return new Actor(
            obj.id,
            obj.kind
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Actor.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Actor.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Actor'
    public baboonTypeIdentifier() {
        return Actor.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Actor.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Actor.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Actor.BaboonMinReaderVersions
    }
    public static jsonCodec(): Actor_JsonCodec {
        return Actor_JsonCodec.instance
    }
}

export class Actor_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Actor): unknown {
        if (this !== Actor_JsonCodec.lazyInstance.value) {
          return Actor_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "kind": ActorKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Actor {
        if (this !== Actor_JsonCodec .lazyInstance.value) {
            return Actor_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Actor (
            obj["id"] as string,
            ActorKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Actor_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Actor_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Actor'
    public baboonTypeIdentifier() {
        return Actor_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Actor_JsonCodec())
    public static get instance(): Actor_JsonCodec {
        return Actor_JsonCodec.lazyInstance.value
    }
}