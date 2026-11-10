import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Grouping {
    All = "All",
    Alternative = "Alternative",
    Navigation = "Navigation"
}

export const Grouping_values: ReadonlyArray<Grouping> = [
    Grouping.All,
    Grouping.Alternative,
    Grouping.Navigation
] as const;

export function Grouping_parse(s: string): Grouping {
    const found = Grouping_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Grouping variant: " + s);
    }
    return found;
}

export class Grouping_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Grouping): unknown {
        if (this !== Grouping_JsonCodec.lazyInstance.value) {
          return Grouping_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Grouping {
        if (this !== Grouping_JsonCodec .lazyInstance.value) {
            return Grouping_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Grouping_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Grouping_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Grouping_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Grouping'
    public baboonTypeIdentifier() {
        return Grouping_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Grouping_JsonCodec())
    public static get instance(): Grouping_JsonCodec {
        return Grouping_JsonCodec.lazyInstance.value
    }
}