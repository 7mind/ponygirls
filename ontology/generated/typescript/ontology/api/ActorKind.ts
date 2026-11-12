import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ActorKind {
    Human = "Human",
    Agent = "Agent",
    Collector = "Collector",
    Service = "Service",
    Unknown = "Unknown"
}

export const ActorKind_values: ReadonlyArray<ActorKind> = [
    ActorKind.Human,
    ActorKind.Agent,
    ActorKind.Collector,
    ActorKind.Service,
    ActorKind.Unknown
] as const;

export function ActorKind_parse(s: string): ActorKind {
    const found = ActorKind_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ActorKind variant: " + s);
    }
    return found;
}

export class ActorKind_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActorKind): unknown {
        if (this !== ActorKind_JsonCodec.lazyInstance.value) {
          return ActorKind_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActorKind {
        if (this !== ActorKind_JsonCodec .lazyInstance.value) {
            return ActorKind_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ActorKind_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ActorKind_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ActorKind_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ActorKind'
    public baboonTypeIdentifier() {
        return ActorKind_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActorKind_JsonCodec())
    public static get instance(): ActorKind_JsonCodec {
        return ActorKind_JsonCodec.lazyInstance.value
    }
}