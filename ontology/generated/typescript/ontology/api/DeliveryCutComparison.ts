import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum DeliveryCutComparison {
    SameGraphAndCoverage = "SameGraphAndCoverage",
    ChangedGraphOrCoverage = "ChangedGraphOrCoverage"
}

export const DeliveryCutComparison_values: ReadonlyArray<DeliveryCutComparison> = [
    DeliveryCutComparison.SameGraphAndCoverage,
    DeliveryCutComparison.ChangedGraphOrCoverage
] as const;

export function DeliveryCutComparison_parse(s: string): DeliveryCutComparison {
    const found = DeliveryCutComparison_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown DeliveryCutComparison variant: " + s);
    }
    return found;
}

export class DeliveryCutComparison_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: DeliveryCutComparison): unknown {
        if (this !== DeliveryCutComparison_JsonCodec.lazyInstance.value) {
          return DeliveryCutComparison_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): DeliveryCutComparison {
        if (this !== DeliveryCutComparison_JsonCodec .lazyInstance.value) {
            return DeliveryCutComparison_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return DeliveryCutComparison_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return DeliveryCutComparison_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return DeliveryCutComparison_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#DeliveryCutComparison'
    public baboonTypeIdentifier() {
        return DeliveryCutComparison_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new DeliveryCutComparison_JsonCodec())
    public static get instance(): DeliveryCutComparison_JsonCodec {
        return DeliveryCutComparison_JsonCodec.lazyInstance.value
    }
}