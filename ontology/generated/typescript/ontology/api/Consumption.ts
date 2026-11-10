import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Consumption {
    Current = "Current",
    Historical = "Historical"
}

export const Consumption_values: ReadonlyArray<Consumption> = [
    Consumption.Current,
    Consumption.Historical
] as const;

export function Consumption_parse(s: string): Consumption {
    const found = Consumption_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Consumption variant: " + s);
    }
    return found;
}

export class Consumption_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Consumption): unknown {
        if (this !== Consumption_JsonCodec.lazyInstance.value) {
          return Consumption_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Consumption {
        if (this !== Consumption_JsonCodec .lazyInstance.value) {
            return Consumption_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Consumption_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Consumption_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Consumption_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Consumption'
    public baboonTypeIdentifier() {
        return Consumption_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Consumption_JsonCodec())
    public static get instance(): Consumption_JsonCodec {
        return Consumption_JsonCodec.lazyInstance.value
    }
}