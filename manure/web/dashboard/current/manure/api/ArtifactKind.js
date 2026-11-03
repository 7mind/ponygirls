import { BaboonDecoderFailure, Lazy } from '../../BaboonSharedRuntime.js';
export var ArtifactKind;
(function (ArtifactKind) {
    ArtifactKind["File"] = "File";
    ArtifactKind["Directory"] = "Directory";
})(ArtifactKind || (ArtifactKind = {}));
export const ArtifactKind_values = [
    ArtifactKind.File,
    ArtifactKind.Directory
];
export function ArtifactKind_parse(s) {
    const found = ArtifactKind_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ArtifactKind variant: " + s);
    }
    return found;
}
export class ArtifactKind_JsonCodec {
    encode(ctx, value) {
        if (this !== ArtifactKind_JsonCodec.lazyInstance.value) {
            return ArtifactKind_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return value;
    }
    decode(ctx, json) {
        if (this !== ArtifactKind_JsonCodec.lazyInstance.value) {
            return ArtifactKind_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        return ArtifactKind_parse(json);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ArtifactKind_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ArtifactKind_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ArtifactKind';
    baboonTypeIdentifier() {
        return ArtifactKind_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ArtifactKind_JsonCodec());
    static get instance() {
        return ArtifactKind_JsonCodec.lazyInstance.value;
    }
}
