import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Actor, Actor_JsonCodec} from './Actor.js'

export class Identity implements BaboonGeneratedLatest {
    private readonly _actor: Actor;
    private readonly _scopes: Array<string>;

    constructor(actor: Actor, scopes: Array<string>) {
        this._actor = actor
        this._scopes = scopes
    }

    public get actor(): Actor {
        return this._actor;
    }
    public get scopes(): Array<string> {
        return this._scopes;
    }

    public toJSON(): Record<string, unknown> {
        return {
            actor: this._actor,
            scopes: this._scopes
        };
    }

    public with(overrides: {actor?: Actor; scopes?: Array<string>}): Identity {
        return new Identity(
            'actor' in overrides ? overrides.actor! : this._actor,
            'scopes' in overrides ? overrides.scopes! : this._scopes
        );
    }

    public static fromPlain(obj: {actor: Actor; scopes: Array<string>}): Identity {
        return new Identity(
            obj.actor,
            obj.scopes
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Identity.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Identity.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Identity'
    public baboonTypeIdentifier() {
        return Identity.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Identity.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Identity.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Identity.BaboonMinReaderVersions
    }
    public static jsonCodec(): Identity_JsonCodec {
        return Identity_JsonCodec.instance
    }
}

export class Identity_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Identity): unknown {
        if (this !== Identity_JsonCodec.lazyInstance.value) {
          return Identity_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "actor": Actor_JsonCodec.instance.encode(BaboonCodecContext.Default, value.actor),
            "scopes": Array.from(value.scopes),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Identity {
        if (this !== Identity_JsonCodec .lazyInstance.value) {
            return Identity_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Identity (
            Actor_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["actor"]),
            (obj["scopes"] as unknown[]).map(item => item as string),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Identity_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Identity_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Identity'
    public baboonTypeIdentifier() {
        return Identity_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Identity_JsonCodec())
    public static get instance(): Identity_JsonCodec {
        return Identity_JsonCodec.lazyInstance.value
    }
}