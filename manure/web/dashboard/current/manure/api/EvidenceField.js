import { BaboonDecoderFailure, Lazy } from '../../BaboonSharedRuntime.js';
export var EvidenceField;
(function (EvidenceField) {
    EvidenceField["Name"] = "Name";
    EvidenceField["ManifestPath"] = "ManifestPath";
    EvidenceField["Tag"] = "Tag";
    EvidenceField["Hostname"] = "Hostname";
    EvidenceField["ProjectPath"] = "ProjectPath";
})(EvidenceField || (EvidenceField = {}));
export const EvidenceField_values = [
    EvidenceField.Name,
    EvidenceField.ManifestPath,
    EvidenceField.Tag,
    EvidenceField.Hostname,
    EvidenceField.ProjectPath
];
export function EvidenceField_parse(s) {
    const found = EvidenceField_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown EvidenceField variant: " + s);
    }
    return found;
}
export class EvidenceField_JsonCodec {
    encode(ctx, value) {
        if (this !== EvidenceField_JsonCodec.lazyInstance.value) {
            return EvidenceField_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return value;
    }
    decode(ctx, json) {
        if (this !== EvidenceField_JsonCodec.lazyInstance.value) {
            return EvidenceField_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        return EvidenceField_parse(json);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return EvidenceField_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return EvidenceField_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#EvidenceField';
    baboonTypeIdentifier() {
        return EvidenceField_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new EvidenceField_JsonCodec());
    static get instance() {
        return EvidenceField_JsonCodec.lazyInstance.value;
    }
}
