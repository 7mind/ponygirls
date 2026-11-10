import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Polarity {
    Required = "Required",
    Prohibited = "Prohibited"
}

export const Polarity_values: ReadonlyArray<Polarity> = [
    Polarity.Required,
    Polarity.Prohibited
] as const;

export function Polarity_parse(s: string): Polarity {
    const found = Polarity_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Polarity variant: " + s);
    }
    return found;
}

export class Polarity_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Polarity): unknown {
        if (this !== Polarity_JsonCodec.lazyInstance.value) {
          return Polarity_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Polarity {
        if (this !== Polarity_JsonCodec .lazyInstance.value) {
            return Polarity_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Polarity_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Polarity_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Polarity_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Polarity'
    public baboonTypeIdentifier() {
        return Polarity_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Polarity_JsonCodec())
    public static get instance(): Polarity_JsonCodec {
        return Polarity_JsonCodec.lazyInstance.value
    }
}