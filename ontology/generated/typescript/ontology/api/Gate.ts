import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Gate {
    Completion = "Completion",
    Fulfillment = "Fulfillment"
}

export const Gate_values: ReadonlyArray<Gate> = [
    Gate.Completion,
    Gate.Fulfillment
] as const;

export function Gate_parse(s: string): Gate {
    const found = Gate_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Gate variant: " + s);
    }
    return found;
}

export class Gate_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Gate): unknown {
        if (this !== Gate_JsonCodec.lazyInstance.value) {
          return Gate_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Gate {
        if (this !== Gate_JsonCodec .lazyInstance.value) {
            return Gate_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Gate_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Gate_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Gate_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Gate'
    public baboonTypeIdentifier() {
        return Gate_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Gate_JsonCodec())
    public static get instance(): Gate_JsonCodec {
        return Gate_JsonCodec.lazyInstance.value
    }
}