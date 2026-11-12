import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Escalation {
    NoEscalation = "NoEscalation",
    HumanRequired = "HumanRequired",
    Unresolved = "Unresolved"
}

export const Escalation_values: ReadonlyArray<Escalation> = [
    Escalation.NoEscalation,
    Escalation.HumanRequired,
    Escalation.Unresolved
] as const;

export function Escalation_parse(s: string): Escalation {
    const found = Escalation_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Escalation variant: " + s);
    }
    return found;
}

export class Escalation_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Escalation): unknown {
        if (this !== Escalation_JsonCodec.lazyInstance.value) {
          return Escalation_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Escalation {
        if (this !== Escalation_JsonCodec .lazyInstance.value) {
            return Escalation_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Escalation_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Escalation_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Escalation_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Escalation'
    public baboonTypeIdentifier() {
        return Escalation_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Escalation_JsonCodec())
    public static get instance(): Escalation_JsonCodec {
        return Escalation_JsonCodec.lazyInstance.value
    }
}