import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../../BaboonSharedRuntime.js'

export enum SearchCountScope {
    ExactMatches = "ExactMatches",
    CandidateWindow = "CandidateWindow"
}

export const SearchCountScope_values: ReadonlyArray<SearchCountScope> = [
    SearchCountScope.ExactMatches,
    SearchCountScope.CandidateWindow
] as const;

export function SearchCountScope_parse(s: string): SearchCountScope {
    const found = SearchCountScope_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown SearchCountScope variant: " + s);
    }
    return found;
}

/** @deprecated Version 1.2.0 is deprecated, you should migrate to 1.8.0 */
export class SearchCountScope_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SearchCountScope): unknown {
        if (this !== SearchCountScope_JsonCodec.lazyInstance.value) {
          return SearchCountScope_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SearchCountScope {
        if (this !== SearchCountScope_JsonCodec .lazyInstance.value) {
            return SearchCountScope_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return SearchCountScope_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return SearchCountScope_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SearchCountScope_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SearchCountScope'
    public baboonTypeIdentifier() {
        return SearchCountScope_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SearchCountScope_JsonCodec())
    public static get instance(): SearchCountScope_JsonCodec {
        return SearchCountScope_JsonCodec.lazyInstance.value
    }
}