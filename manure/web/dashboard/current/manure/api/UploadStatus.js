import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { ArtifactState_JsonCodec } from './ArtifactState.js';
import { FileProgress_JsonCodec } from './FileProgress.js';
export class UploadStatus {
    _artifactId;
    _state;
    _chunkBytes;
    _files;
    constructor(artifactId, state, chunkBytes, files) {
        this._artifactId = artifactId;
        this._state = state;
        this._chunkBytes = chunkBytes;
        this._files = files;
    }
    get artifactId() {
        return this._artifactId;
    }
    get state() {
        return this._state;
    }
    get chunkBytes() {
        return this._chunkBytes;
    }
    get files() {
        return this._files;
    }
    toJSON() {
        return {
            artifactId: this._artifactId,
            state: this._state,
            chunkBytes: this._chunkBytes,
            files: this._files
        };
    }
    with(overrides) {
        return new UploadStatus('artifactId' in overrides ? overrides.artifactId : this._artifactId, 'state' in overrides ? overrides.state : this._state, 'chunkBytes' in overrides ? overrides.chunkBytes : this._chunkBytes, 'files' in overrides ? overrides.files : this._files);
    }
    static fromPlain(obj) {
        return new UploadStatus(obj.artifactId, obj.state, obj.chunkBytes, obj.files);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return UploadStatus.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return UploadStatus.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#UploadStatus';
    baboonTypeIdentifier() {
        return UploadStatus.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return UploadStatus.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return UploadStatus.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return UploadStatus.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return UploadStatus_JsonCodec.instance;
    }
}
export class UploadStatus_JsonCodec {
    encode(ctx, value) {
        if (this !== UploadStatus_JsonCodec.lazyInstance.value) {
            return UploadStatus_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifactId": value.artifactId,
            "state": ArtifactState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.state),
            "chunkBytes": value.chunkBytes,
            "files": Array.from(value.files).map(item => FileProgress_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        };
    }
    decode(ctx, json) {
        if (this !== UploadStatus_JsonCodec.lazyInstance.value) {
            return UploadStatus_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new UploadStatus(obj["artifactId"], ArtifactState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]), obj["chunkBytes"], obj["files"].map(item => FileProgress_JsonCodec.instance.decode(BaboonCodecContext.Default, item)));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return UploadStatus_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return UploadStatus_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#UploadStatus';
    baboonTypeIdentifier() {
        return UploadStatus_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new UploadStatus_JsonCodec());
    static get instance() {
        return UploadStatus_JsonCodec.lazyInstance.value;
    }
}
