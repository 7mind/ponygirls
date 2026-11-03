import { BaboonDecoderFailure, Lazy } from '../../BaboonSharedRuntime.js';
export var ContentMode;
(function (ContentMode) {
    ContentMode["Subdomain"] = "Subdomain";
    ContentMode["Path"] = "Path";
})(ContentMode || (ContentMode = {}));
export const ContentMode_values = [
    ContentMode.Subdomain,
    ContentMode.Path
];
export function ContentMode_parse(s) {
    const found = ContentMode_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ContentMode variant: " + s);
    }
    return found;
}
export class ContentMode_JsonCodec {
    encode(ctx, value) {
        if (this !== ContentMode_JsonCodec.lazyInstance.value) {
            return ContentMode_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return value;
    }
    decode(ctx, json) {
        if (this !== ContentMode_JsonCodec.lazyInstance.value) {
            return ContentMode_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        return ContentMode_parse(json);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ContentMode_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ContentMode_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ContentMode';
    baboonTypeIdentifier() {
        return ContentMode_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ContentMode_JsonCodec());
    static get instance() {
        return ContentMode_JsonCodec.lazyInstance.value;
    }
}
