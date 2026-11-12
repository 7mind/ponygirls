import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Capability {
    Read = "Read",
    Mutate = "Mutate",
    Capture = "Capture",
    Review = "Review",
    HostCapture = "HostCapture"
}

export const Capability_values: ReadonlyArray<Capability> = [
    Capability.Read,
    Capability.Mutate,
    Capability.Capture,
    Capability.Review,
    Capability.HostCapture
] as const;

export function Capability_parse(s: string): Capability {
    const found = Capability_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Capability variant: " + s);
    }
    return found;
}

export class Capability_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Capability): unknown {
        if (this !== Capability_JsonCodec.lazyInstance.value) {
          return Capability_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Capability {
        if (this !== Capability_JsonCodec .lazyInstance.value) {
            return Capability_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Capability_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Capability_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Capability_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Capability'
    public baboonTypeIdentifier() {
        return Capability_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Capability_JsonCodec())
    public static get instance(): Capability_JsonCodec {
        return Capability_JsonCodec.lazyInstance.value
    }
}