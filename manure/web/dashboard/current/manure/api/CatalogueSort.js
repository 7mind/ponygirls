import { BaboonDecoderFailure, Lazy } from '../../BaboonSharedRuntime.js';
export var CatalogueSort;
(function (CatalogueSort) {
    CatalogueSort["Name"] = "Name";
    CatalogueSort["CreatedAt"] = "CreatedAt";
    CatalogueSort["ExpiresAt"] = "ExpiresAt";
    CatalogueSort["TotalBytes"] = "TotalBytes";
    CatalogueSort["FileCount"] = "FileCount";
    CatalogueSort["Visibility"] = "Visibility";
    CatalogueSort["State"] = "State";
    CatalogueSort["Kind"] = "Kind";
    CatalogueSort["CreatedByUser"] = "CreatedByUser";
})(CatalogueSort || (CatalogueSort = {}));
export const CatalogueSort_values = [
    CatalogueSort.Name,
    CatalogueSort.CreatedAt,
    CatalogueSort.ExpiresAt,
    CatalogueSort.TotalBytes,
    CatalogueSort.FileCount,
    CatalogueSort.Visibility,
    CatalogueSort.State,
    CatalogueSort.Kind,
    CatalogueSort.CreatedByUser
];
export function CatalogueSort_parse(s) {
    const found = CatalogueSort_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown CatalogueSort variant: " + s);
    }
    return found;
}
export class CatalogueSort_JsonCodec {
    encode(ctx, value) {
        if (this !== CatalogueSort_JsonCodec.lazyInstance.value) {
            return CatalogueSort_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return value;
    }
    decode(ctx, json) {
        if (this !== CatalogueSort_JsonCodec.lazyInstance.value) {
            return CatalogueSort_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        return CatalogueSort_parse(json);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return CatalogueSort_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return CatalogueSort_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#CatalogueSort';
    baboonTypeIdentifier() {
        return CatalogueSort_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new CatalogueSort_JsonCodec());
    static get instance() {
        return CatalogueSort_JsonCodec.lazyInstance.value;
    }
}
