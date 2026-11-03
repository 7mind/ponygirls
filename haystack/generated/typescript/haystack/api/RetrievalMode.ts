import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum RetrievalMode {
    Lexical = "Lexical",
    Semantic = "Semantic",
    Hybrid = "Hybrid"
}

export const RetrievalMode_values: ReadonlyArray<RetrievalMode> = [
    RetrievalMode.Lexical,
    RetrievalMode.Semantic,
    RetrievalMode.Hybrid
] as const;

export function RetrievalMode_parse(s: string): RetrievalMode {
    const found = RetrievalMode_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown RetrievalMode variant: " + s);
    }
    return found;
}

export class RetrievalMode_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RetrievalMode): unknown {
        if (this !== RetrievalMode_JsonCodec.lazyInstance.value) {
          return RetrievalMode_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RetrievalMode {
        if (this !== RetrievalMode_JsonCodec .lazyInstance.value) {
            return RetrievalMode_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return RetrievalMode_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return RetrievalMode_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return RetrievalMode_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#RetrievalMode'
    public baboonTypeIdentifier() {
        return RetrievalMode_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RetrievalMode_JsonCodec())
    public static get instance(): RetrievalMode_JsonCodec {
        return RetrievalMode_JsonCodec.lazyInstance.value
    }
}