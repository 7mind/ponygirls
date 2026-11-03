import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { ExpiryChange_JsonCodec } from './ExpiryChange.js';
import { Visibility_JsonCodec } from './Visibility.js';
export class ArtifactPatch {
    _name;
    _visibility;
    _expiry;
    constructor(name, visibility, expiry) {
        this._name = name;
        this._visibility = visibility;
        this._expiry = expiry;
    }
    get name() {
        return this._name;
    }
    get visibility() {
        return this._visibility;
    }
    get expiry() {
        return this._expiry;
    }
    toJSON() {
        return {
            name: this._name !== undefined ? this._name : undefined,
            visibility: this._visibility !== undefined ? this._visibility : undefined,
            expiry: this._expiry
        };
    }
    with(overrides) {
        return new ArtifactPatch('name' in overrides ? overrides.name : this._name, 'visibility' in overrides ? overrides.visibility : this._visibility, 'expiry' in overrides ? overrides.expiry : this._expiry);
    }
    static fromPlain(obj) {
        return new ArtifactPatch(obj.name, obj.visibility, obj.expiry);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ArtifactPatch.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ArtifactPatch.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ArtifactPatch';
    baboonTypeIdentifier() {
        return ArtifactPatch.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return ArtifactPatch.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return ArtifactPatch.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return ArtifactPatch.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return ArtifactPatch_JsonCodec.instance;
    }
}
export class ArtifactPatch_JsonCodec {
    encode(ctx, value) {
        if (this !== ArtifactPatch_JsonCodec.lazyInstance.value) {
            return ArtifactPatch_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "name": value.name === undefined ? null : value.name,
            "visibility": value.visibility === undefined ? null : Visibility_JsonCodec.instance.encode(BaboonCodecContext.Default, value.visibility),
            "expiry": ExpiryChange_JsonCodec.instance.encode(BaboonCodecContext.Default, value.expiry),
        };
    }
    decode(ctx, json) {
        if (this !== ArtifactPatch_JsonCodec.lazyInstance.value) {
            return ArtifactPatch_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new ArtifactPatch(obj["name"] === undefined || obj["name"] === null ? undefined : obj["name"] === undefined || obj["name"] === null ? undefined : obj["name"], obj["visibility"] === undefined || obj["visibility"] === null ? undefined : obj["visibility"] === undefined || obj["visibility"] === null ? undefined : Visibility_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["visibility"]), ExpiryChange_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["expiry"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ArtifactPatch_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ArtifactPatch_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ArtifactPatch';
    baboonTypeIdentifier() {
        return ArtifactPatch_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ArtifactPatch_JsonCodec());
    static get instance() {
        return ArtifactPatch_JsonCodec.lazyInstance.value;
    }
}
