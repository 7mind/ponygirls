import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../../BaboonSharedRuntime.js'

export enum SearchMode {
    Lexical = "Lexical",
    Semantic = "Semantic",
    Hybrid = "Hybrid"
}

export const SearchMode_values: ReadonlyArray<SearchMode> = [
    SearchMode.Lexical,
    SearchMode.Semantic,
    SearchMode.Hybrid
] as const;

export function SearchMode_parse(s: string): SearchMode {
    const found = SearchMode_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown SearchMode variant: " + s);
    }
    return found;
}

/** @deprecated Version 1.7.0 is deprecated, you should migrate to 1.8.0 */
export class SearchMode_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SearchMode): unknown {
        if (this !== SearchMode_JsonCodec.lazyInstance.value) {
          return SearchMode_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SearchMode {
        if (this !== SearchMode_JsonCodec .lazyInstance.value) {
            return SearchMode_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return SearchMode_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return SearchMode_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SearchMode_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SearchMode'
    public baboonTypeIdentifier() {
        return SearchMode_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SearchMode_JsonCodec())
    public static get instance(): SearchMode_JsonCodec {
        return SearchMode_JsonCodec.lazyInstance.value
    }
}