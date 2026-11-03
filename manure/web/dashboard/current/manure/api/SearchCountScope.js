import { BaboonDecoderFailure, Lazy } from '../../BaboonSharedRuntime.js';
export var SearchCountScope;
(function (SearchCountScope) {
    SearchCountScope["ExactMatches"] = "ExactMatches";
    SearchCountScope["CandidateWindow"] = "CandidateWindow";
})(SearchCountScope || (SearchCountScope = {}));
export const SearchCountScope_values = [
    SearchCountScope.ExactMatches,
    SearchCountScope.CandidateWindow
];
export function SearchCountScope_parse(s) {
    const found = SearchCountScope_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown SearchCountScope variant: " + s);
    }
    return found;
}
export class SearchCountScope_JsonCodec {
    encode(ctx, value) {
        if (this !== SearchCountScope_JsonCodec.lazyInstance.value) {
            return SearchCountScope_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return value;
    }
    decode(ctx, json) {
        if (this !== SearchCountScope_JsonCodec.lazyInstance.value) {
            return SearchCountScope_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        return SearchCountScope_parse(json);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return SearchCountScope_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return SearchCountScope_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#SearchCountScope';
    baboonTypeIdentifier() {
        return SearchCountScope_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new SearchCountScope_JsonCodec());
    static get instance() {
        return SearchCountScope_JsonCodec.lazyInstance.value;
    }
}
