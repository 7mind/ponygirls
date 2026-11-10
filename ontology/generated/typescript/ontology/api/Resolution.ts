import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Resolution {
    Fulfilled = "Fulfilled",
    NotFulfilled = "NotFulfilled",
    Inconclusive = "Inconclusive"
}

export const Resolution_values: ReadonlyArray<Resolution> = [
    Resolution.Fulfilled,
    Resolution.NotFulfilled,
    Resolution.Inconclusive
] as const;

export function Resolution_parse(s: string): Resolution {
    const found = Resolution_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Resolution variant: " + s);
    }
    return found;
}

export class Resolution_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Resolution): unknown {
        if (this !== Resolution_JsonCodec.lazyInstance.value) {
          return Resolution_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Resolution {
        if (this !== Resolution_JsonCodec .lazyInstance.value) {
            return Resolution_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Resolution_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Resolution_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Resolution_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Resolution'
    public baboonTypeIdentifier() {
        return Resolution_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Resolution_JsonCodec())
    public static get instance(): Resolution_JsonCodec {
        return Resolution_JsonCodec.lazyInstance.value
    }
}