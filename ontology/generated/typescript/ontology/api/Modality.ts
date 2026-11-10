import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Modality {
    Assertion = "Assertion",
    Prediction = "Prediction",
    Assumption = "Assumption",
    ObservationAccount = "ObservationAccount"
}

export const Modality_values: ReadonlyArray<Modality> = [
    Modality.Assertion,
    Modality.Prediction,
    Modality.Assumption,
    Modality.ObservationAccount
] as const;

export function Modality_parse(s: string): Modality {
    const found = Modality_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Modality variant: " + s);
    }
    return found;
}

export class Modality_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Modality): unknown {
        if (this !== Modality_JsonCodec.lazyInstance.value) {
          return Modality_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Modality {
        if (this !== Modality_JsonCodec .lazyInstance.value) {
            return Modality_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Modality_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Modality_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Modality_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Modality'
    public baboonTypeIdentifier() {
        return Modality_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Modality_JsonCodec())
    public static get instance(): Modality_JsonCodec {
        return Modality_JsonCodec.lazyInstance.value
    }
}