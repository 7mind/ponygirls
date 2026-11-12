import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Execution {
    Delegated = "Delegated",
    HumanRequired = "HumanRequired"
}

export const Execution_values: ReadonlyArray<Execution> = [
    Execution.Delegated,
    Execution.HumanRequired
] as const;

export function Execution_parse(s: string): Execution {
    const found = Execution_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Execution variant: " + s);
    }
    return found;
}

export class Execution_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Execution): unknown {
        if (this !== Execution_JsonCodec.lazyInstance.value) {
          return Execution_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Execution {
        if (this !== Execution_JsonCodec .lazyInstance.value) {
            return Execution_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Execution_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Execution_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Execution_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Execution'
    public baboonTypeIdentifier() {
        return Execution_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Execution_JsonCodec())
    public static get instance(): Execution_JsonCodec {
        return Execution_JsonCodec.lazyInstance.value
    }
}