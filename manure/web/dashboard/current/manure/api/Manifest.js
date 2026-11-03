import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { ArtifactState_JsonCodec } from './ArtifactState.js';
import { ManifestEntry_JsonCodec } from './ManifestEntry.js';
export class Manifest {
    _artifactId;
    _state;
    _files;
    constructor(artifactId, state, files) {
        this._artifactId = artifactId;
        this._state = state;
        this._files = files;
    }
    get artifactId() {
        return this._artifactId;
    }
    get state() {
        return this._state;
    }
    get files() {
        return this._files;
    }
    toJSON() {
        return {
            artifactId: this._artifactId,
            state: this._state,
            files: this._files
        };
    }
    with(overrides) {
        return new Manifest('artifactId' in overrides ? overrides.artifactId : this._artifactId, 'state' in overrides ? overrides.state : this._state, 'files' in overrides ? overrides.files : this._files);
    }
    static fromPlain(obj) {
        return new Manifest(obj.artifactId, obj.state, obj.files);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Manifest.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Manifest.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#Manifest';
    baboonTypeIdentifier() {
        return Manifest.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Manifest.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Manifest.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Manifest.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return Manifest_JsonCodec.instance;
    }
}
export class Manifest_JsonCodec {
    encode(ctx, value) {
        if (this !== Manifest_JsonCodec.lazyInstance.value) {
            return Manifest_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifactId": value.artifactId,
            "state": ArtifactState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.state),
            "files": Array.from(value.files).map(item => ManifestEntry_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        };
    }
    decode(ctx, json) {
        if (this !== Manifest_JsonCodec.lazyInstance.value) {
            return Manifest_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Manifest(obj["artifactId"], ArtifactState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]), obj["files"].map(item => ManifestEntry_JsonCodec.instance.decode(BaboonCodecContext.Default, item)));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Manifest_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Manifest_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#Manifest';
    baboonTypeIdentifier() {
        return Manifest_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Manifest_JsonCodec());
    static get instance() {
        return Manifest_JsonCodec.lazyInstance.value;
    }
}
