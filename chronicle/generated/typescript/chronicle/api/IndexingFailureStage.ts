import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum IndexingFailureStage {
    Annotation = "Annotation",
    Embedding = "Embedding",
    Publication = "Publication"
}

export const IndexingFailureStage_values: ReadonlyArray<IndexingFailureStage> = [
    IndexingFailureStage.Annotation,
    IndexingFailureStage.Embedding,
    IndexingFailureStage.Publication
] as const;

export function IndexingFailureStage_parse(s: string): IndexingFailureStage {
    const found = IndexingFailureStage_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown IndexingFailureStage variant: " + s);
    }
    return found;
}

export class IndexingFailureStage_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: IndexingFailureStage): unknown {
        if (this !== IndexingFailureStage_JsonCodec.lazyInstance.value) {
          return IndexingFailureStage_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): IndexingFailureStage {
        if (this !== IndexingFailureStage_JsonCodec .lazyInstance.value) {
            return IndexingFailureStage_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return IndexingFailureStage_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return IndexingFailureStage_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return IndexingFailureStage_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#IndexingFailureStage'
    public baboonTypeIdentifier() {
        return IndexingFailureStage_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new IndexingFailureStage_JsonCodec())
    public static get instance(): IndexingFailureStage_JsonCodec {
        return IndexingFailureStage_JsonCodec.lazyInstance.value
    }
}