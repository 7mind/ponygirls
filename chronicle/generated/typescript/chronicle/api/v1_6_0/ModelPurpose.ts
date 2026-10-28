import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../../BaboonSharedRuntime.js'

export enum ModelPurpose {
    Annotation = "Annotation",
    DocumentEmbedding = "DocumentEmbedding",
    QueryEmbedding = "QueryEmbedding",
    McpTest = "McpTest"
}

export const ModelPurpose_values: ReadonlyArray<ModelPurpose> = [
    ModelPurpose.Annotation,
    ModelPurpose.DocumentEmbedding,
    ModelPurpose.QueryEmbedding,
    ModelPurpose.McpTest
] as const;

export function ModelPurpose_parse(s: string): ModelPurpose {
    const found = ModelPurpose_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ModelPurpose variant: " + s);
    }
    return found;
}

/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.7.0 */
export class ModelPurpose_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ModelPurpose): unknown {
        if (this !== ModelPurpose_JsonCodec.lazyInstance.value) {
          return ModelPurpose_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ModelPurpose {
        if (this !== ModelPurpose_JsonCodec .lazyInstance.value) {
            return ModelPurpose_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ModelPurpose_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return ModelPurpose_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ModelPurpose_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ModelPurpose'
    public baboonTypeIdentifier() {
        return ModelPurpose_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ModelPurpose_JsonCodec())
    public static get instance(): ModelPurpose_JsonCodec {
        return ModelPurpose_JsonCodec.lazyInstance.value
    }
}