import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum CapsulePartition {
    SelectedWorkContext = "SelectedWorkContext",
    UnresolvedScopeContext = "UnresolvedScopeContext",
    SupportingContext = "SupportingContext",
    HistoricalContext = "HistoricalContext"
}

export const CapsulePartition_values: ReadonlyArray<CapsulePartition> = [
    CapsulePartition.SelectedWorkContext,
    CapsulePartition.UnresolvedScopeContext,
    CapsulePartition.SupportingContext,
    CapsulePartition.HistoricalContext
] as const;

export function CapsulePartition_parse(s: string): CapsulePartition {
    const found = CapsulePartition_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown CapsulePartition variant: " + s);
    }
    return found;
}

export class CapsulePartition_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CapsulePartition): unknown {
        if (this !== CapsulePartition_JsonCodec.lazyInstance.value) {
          return CapsulePartition_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CapsulePartition {
        if (this !== CapsulePartition_JsonCodec .lazyInstance.value) {
            return CapsulePartition_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return CapsulePartition_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsulePartition_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsulePartition_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsulePartition'
    public baboonTypeIdentifier() {
        return CapsulePartition_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CapsulePartition_JsonCodec())
    public static get instance(): CapsulePartition_JsonCodec {
        return CapsulePartition_JsonCodec.lazyInstance.value
    }
}