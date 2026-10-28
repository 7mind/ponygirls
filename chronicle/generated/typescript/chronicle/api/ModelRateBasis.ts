import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ModelRateBasis {
    ProviderReportedCompletedCalls = "ProviderReportedCompletedCalls"
}

export const ModelRateBasis_values: ReadonlyArray<ModelRateBasis> = [
    ModelRateBasis.ProviderReportedCompletedCalls
] as const;

export function ModelRateBasis_parse(s: string): ModelRateBasis {
    const found = ModelRateBasis_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ModelRateBasis variant: " + s);
    }
    return found;
}

export class ModelRateBasis_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ModelRateBasis): unknown {
        if (this !== ModelRateBasis_JsonCodec.lazyInstance.value) {
          return ModelRateBasis_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ModelRateBasis {
        if (this !== ModelRateBasis_JsonCodec .lazyInstance.value) {
            return ModelRateBasis_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ModelRateBasis_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return ModelRateBasis_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ModelRateBasis_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ModelRateBasis'
    public baboonTypeIdentifier() {
        return ModelRateBasis_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ModelRateBasis_JsonCodec())
    public static get instance(): ModelRateBasis_JsonCodec {
        return ModelRateBasis_JsonCodec.lazyInstance.value
    }
}