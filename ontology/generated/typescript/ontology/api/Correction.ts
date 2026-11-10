import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Correction {
    Implementation = "Implementation",
    Interpretation = "Interpretation",
    IntentChange = "IntentChange",
    Mixed = "Mixed",
    Unresolved = "Unresolved"
}

export const Correction_values: ReadonlyArray<Correction> = [
    Correction.Implementation,
    Correction.Interpretation,
    Correction.IntentChange,
    Correction.Mixed,
    Correction.Unresolved
] as const;

export function Correction_parse(s: string): Correction {
    const found = Correction_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Correction variant: " + s);
    }
    return found;
}

export class Correction_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Correction): unknown {
        if (this !== Correction_JsonCodec.lazyInstance.value) {
          return Correction_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Correction {
        if (this !== Correction_JsonCodec .lazyInstance.value) {
            return Correction_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Correction_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Correction_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Correction_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Correction'
    public baboonTypeIdentifier() {
        return Correction_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Correction_JsonCodec())
    public static get instance(): Correction_JsonCodec {
        return Correction_JsonCodec.lazyInstance.value
    }
}