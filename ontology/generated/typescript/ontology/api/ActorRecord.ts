import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Actor, Actor_JsonCodec} from './Actor.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class ActorRecord implements BaboonGeneratedLatest {
    private readonly _ref: Ref;
    private readonly _value: Actor;

    constructor(ref: Ref, value: Actor) {
        this._ref = ref
        this._value = value
    }

    public get ref(): Ref {
        return this._ref;
    }
    public get value(): Actor {
        return this._value;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ref: this._ref,
            value: this._value
        };
    }

    public with(overrides: {ref?: Ref; value?: Actor}): ActorRecord {
        return new ActorRecord(
            'ref' in overrides ? overrides.ref! : this._ref,
            'value' in overrides ? overrides.value! : this._value
        );
    }

    public static fromPlain(obj: {ref: Ref; value: Actor}): ActorRecord {
        return new ActorRecord(
            obj.ref,
            obj.value
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ActorRecord.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ActorRecord.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ActorRecord'
    public baboonTypeIdentifier() {
        return ActorRecord.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ActorRecord.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ActorRecord.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ActorRecord.BaboonMinReaderVersions
    }
    public static jsonCodec(): ActorRecord_JsonCodec {
        return ActorRecord_JsonCodec.instance
    }
}

export class ActorRecord_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActorRecord): unknown {
        if (this !== ActorRecord_JsonCodec.lazyInstance.value) {
          return ActorRecord_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
            "value": Actor_JsonCodec.instance.encode(BaboonCodecContext.Default, value.value),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActorRecord {
        if (this !== ActorRecord_JsonCodec .lazyInstance.value) {
            return ActorRecord_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActorRecord (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
            Actor_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["value"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ActorRecord_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ActorRecord_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ActorRecord'
    public baboonTypeIdentifier() {
        return ActorRecord_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActorRecord_JsonCodec())
    public static get instance(): ActorRecord_JsonCodec {
        return ActorRecord_JsonCodec.lazyInstance.value
    }
}