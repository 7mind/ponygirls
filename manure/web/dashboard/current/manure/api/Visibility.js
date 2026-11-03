import { BaboonDecoderFailure, Lazy } from '../../BaboonSharedRuntime.js';
export var Visibility;
(function (Visibility) {
    Visibility["Internal"] = "Internal";
    Visibility["External"] = "External";
    Visibility["Public"] = "Public";
})(Visibility || (Visibility = {}));
export const Visibility_values = [
    Visibility.Internal,
    Visibility.External,
    Visibility.Public
];
export function Visibility_parse(s) {
    const found = Visibility_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Visibility variant: " + s);
    }
    return found;
}
export class Visibility_JsonCodec {
    encode(ctx, value) {
        if (this !== Visibility_JsonCodec.lazyInstance.value) {
            return Visibility_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return value;
    }
    decode(ctx, json) {
        if (this !== Visibility_JsonCodec.lazyInstance.value) {
            return Visibility_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        return Visibility_parse(json);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Visibility_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Visibility_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#Visibility';
    baboonTypeIdentifier() {
        return Visibility_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Visibility_JsonCodec());
    static get instance() {
        return Visibility_JsonCodec.lazyInstance.value;
    }
}
