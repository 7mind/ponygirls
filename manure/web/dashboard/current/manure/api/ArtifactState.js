import { BaboonDecoderFailure, Lazy } from '../../BaboonSharedRuntime.js';
export var ArtifactState;
(function (ArtifactState) {
    ArtifactState["Uploading"] = "Uploading";
    ArtifactState["Publishing"] = "Publishing";
    ArtifactState["Ready"] = "Ready";
})(ArtifactState || (ArtifactState = {}));
export const ArtifactState_values = [
    ArtifactState.Uploading,
    ArtifactState.Publishing,
    ArtifactState.Ready
];
export function ArtifactState_parse(s) {
    const found = ArtifactState_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ArtifactState variant: " + s);
    }
    return found;
}
export class ArtifactState_JsonCodec {
    encode(ctx, value) {
        if (this !== ArtifactState_JsonCodec.lazyInstance.value) {
            return ArtifactState_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return value;
    }
    decode(ctx, json) {
        if (this !== ArtifactState_JsonCodec.lazyInstance.value) {
            return ArtifactState_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        return ArtifactState_parse(json);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ArtifactState_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ArtifactState_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ArtifactState';
    baboonTypeIdentifier() {
        return ArtifactState_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ArtifactState_JsonCodec());
    static get instance() {
        return ArtifactState_JsonCodec.lazyInstance.value;
    }
}
