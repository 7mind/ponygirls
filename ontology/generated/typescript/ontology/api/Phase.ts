import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Phase {
    Planned = "Planned",
    Active = "Active",
    Blocked = "Blocked",
    Completed = "Completed",
    Cancelled = "Cancelled"
}

export const Phase_values: ReadonlyArray<Phase> = [
    Phase.Planned,
    Phase.Active,
    Phase.Blocked,
    Phase.Completed,
    Phase.Cancelled
] as const;

export function Phase_parse(s: string): Phase {
    const found = Phase_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Phase variant: " + s);
    }
    return found;
}

export class Phase_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Phase): unknown {
        if (this !== Phase_JsonCodec.lazyInstance.value) {
          return Phase_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Phase {
        if (this !== Phase_JsonCodec .lazyInstance.value) {
            return Phase_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Phase_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Phase_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Phase_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Phase'
    public baboonTypeIdentifier() {
        return Phase_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Phase_JsonCodec())
    public static get instance(): Phase_JsonCodec {
        return Phase_JsonCodec.lazyInstance.value
    }
}