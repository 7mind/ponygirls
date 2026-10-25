import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Completion {
    Quiescent = "Quiescent",
    Closed = "Closed"
}

export const Completion_values: ReadonlyArray<Completion> = [
    Completion.Quiescent,
    Completion.Closed
] as const;

export function Completion_parse(s: string): Completion {
    const found = Completion_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Completion variant: " + s);
    }
    return found;
}

export class Completion_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Completion): unknown {
        if (this !== Completion_JsonCodec.lazyInstance.value) {
          return Completion_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Completion {
        if (this !== Completion_JsonCodec .lazyInstance.value) {
            return Completion_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Completion_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.1.0'
    public baboonDomainVersion() {
        return Completion_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Completion_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Completion'
    public baboonTypeIdentifier() {
        return Completion_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Completion_JsonCodec())
    public static get instance(): Completion_JsonCodec {
        return Completion_JsonCodec.lazyInstance.value
    }
}