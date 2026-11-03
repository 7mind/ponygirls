import { BaboonDecoderFailure, Lazy } from '../../BaboonSharedRuntime.js';
export var SearchMode;
(function (SearchMode) {
    SearchMode["Lexical"] = "Lexical";
    SearchMode["Semantic"] = "Semantic";
    SearchMode["Hybrid"] = "Hybrid";
})(SearchMode || (SearchMode = {}));
export const SearchMode_values = [
    SearchMode.Lexical,
    SearchMode.Semantic,
    SearchMode.Hybrid
];
export function SearchMode_parse(s) {
    const found = SearchMode_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown SearchMode variant: " + s);
    }
    return found;
}
export class SearchMode_JsonCodec {
    encode(ctx, value) {
        if (this !== SearchMode_JsonCodec.lazyInstance.value) {
            return SearchMode_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return value;
    }
    decode(ctx, json) {
        if (this !== SearchMode_JsonCodec.lazyInstance.value) {
            return SearchMode_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        return SearchMode_parse(json);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return SearchMode_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return SearchMode_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#SearchMode';
    baboonTypeIdentifier() {
        return SearchMode_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new SearchMode_JsonCodec());
    static get instance() {
        return SearchMode_JsonCodec.lazyInstance.value;
    }
}
