import { BaboonDecoderFailure, Lazy } from '../../BaboonSharedRuntime.js';
export var SortDirection;
(function (SortDirection) {
    SortDirection["Asc"] = "Asc";
    SortDirection["Desc"] = "Desc";
})(SortDirection || (SortDirection = {}));
export const SortDirection_values = [
    SortDirection.Asc,
    SortDirection.Desc
];
export function SortDirection_parse(s) {
    const found = SortDirection_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown SortDirection variant: " + s);
    }
    return found;
}
export class SortDirection_JsonCodec {
    encode(ctx, value) {
        if (this !== SortDirection_JsonCodec.lazyInstance.value) {
            return SortDirection_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return value;
    }
    decode(ctx, json) {
        if (this !== SortDirection_JsonCodec.lazyInstance.value) {
            return SortDirection_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        return SortDirection_parse(json);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return SortDirection_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return SortDirection_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#SortDirection';
    baboonTypeIdentifier() {
        return SortDirection_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new SortDirection_JsonCodec());
    static get instance() {
        return SortDirection_JsonCodec.lazyInstance.value;
    }
}
