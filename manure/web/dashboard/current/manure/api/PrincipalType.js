import { BaboonDecoderFailure, Lazy } from '../../BaboonSharedRuntime.js';
export var PrincipalType;
(function (PrincipalType) {
    PrincipalType["Human"] = "Human";
    PrincipalType["Agent"] = "Agent";
})(PrincipalType || (PrincipalType = {}));
export const PrincipalType_values = [
    PrincipalType.Human,
    PrincipalType.Agent
];
export function PrincipalType_parse(s) {
    const found = PrincipalType_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown PrincipalType variant: " + s);
    }
    return found;
}
export class PrincipalType_JsonCodec {
    encode(ctx, value) {
        if (this !== PrincipalType_JsonCodec.lazyInstance.value) {
            return PrincipalType_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return value;
    }
    decode(ctx, json) {
        if (this !== PrincipalType_JsonCodec.lazyInstance.value) {
            return PrincipalType_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        return PrincipalType_parse(json);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return PrincipalType_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return PrincipalType_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#PrincipalType';
    baboonTypeIdentifier() {
        return PrincipalType_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new PrincipalType_JsonCodec());
    static get instance() {
        return PrincipalType_JsonCodec.lazyInstance.value;
    }
}
