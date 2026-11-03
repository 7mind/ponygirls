import { BaboonCodecContext, BaboonInt64, Lazy } from '../../BaboonSharedRuntime.js';
import { ArtifactKind_JsonCodec } from './ArtifactKind.js';
import { ArtifactState_JsonCodec } from './ArtifactState.js';
import { Visibility_JsonCodec } from './Visibility.js';
export class Artifact {
    _artifactId;
    _name;
    _kind;
    _visibility;
    _state;
    _createdByUser;
    _createdAt;
    _expiresAt;
    _totalBytes;
    _fileCount;
    _contentUrl;
    constructor(artifactId, name, kind, visibility, state, createdByUser, createdAt, expiresAt, totalBytes, fileCount, contentUrl) {
        this._artifactId = artifactId;
        this._name = name;
        this._kind = kind;
        this._visibility = visibility;
        this._state = state;
        this._createdByUser = createdByUser;
        this._createdAt = createdAt;
        this._expiresAt = expiresAt;
        this._totalBytes = totalBytes;
        this._fileCount = fileCount;
        this._contentUrl = contentUrl;
    }
    get artifactId() {
        return this._artifactId;
    }
    get name() {
        return this._name;
    }
    get kind() {
        return this._kind;
    }
    get visibility() {
        return this._visibility;
    }
    get state() {
        return this._state;
    }
    get createdByUser() {
        return this._createdByUser;
    }
    get createdAt() {
        return this._createdAt;
    }
    get expiresAt() {
        return this._expiresAt;
    }
    get totalBytes() {
        return this._totalBytes;
    }
    get fileCount() {
        return this._fileCount;
    }
    get contentUrl() {
        return this._contentUrl;
    }
    toJSON() {
        return {
            artifactId: this._artifactId,
            name: this._name,
            kind: this._kind,
            visibility: this._visibility,
            state: this._state,
            createdByUser: this._createdByUser,
            createdAt: this._createdAt,
            expiresAt: this._expiresAt !== undefined ? this._expiresAt : undefined,
            totalBytes: this._totalBytes,
            fileCount: this._fileCount,
            contentUrl: this._contentUrl
        };
    }
    with(overrides) {
        return new Artifact('artifactId' in overrides ? overrides.artifactId : this._artifactId, 'name' in overrides ? overrides.name : this._name, 'kind' in overrides ? overrides.kind : this._kind, 'visibility' in overrides ? overrides.visibility : this._visibility, 'state' in overrides ? overrides.state : this._state, 'createdByUser' in overrides ? overrides.createdByUser : this._createdByUser, 'createdAt' in overrides ? overrides.createdAt : this._createdAt, 'expiresAt' in overrides ? overrides.expiresAt : this._expiresAt, 'totalBytes' in overrides ? overrides.totalBytes : this._totalBytes, 'fileCount' in overrides ? overrides.fileCount : this._fileCount, 'contentUrl' in overrides ? overrides.contentUrl : this._contentUrl);
    }
    static fromPlain(obj) {
        return new Artifact(obj.artifactId, obj.name, obj.kind, obj.visibility, obj.state, obj.createdByUser, obj.createdAt, obj.expiresAt, obj.totalBytes, obj.fileCount, obj.contentUrl);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Artifact.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Artifact.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#Artifact';
    baboonTypeIdentifier() {
        return Artifact.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Artifact.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Artifact.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Artifact.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return Artifact_JsonCodec.instance;
    }
}
export class Artifact_JsonCodec {
    encode(ctx, value) {
        if (this !== Artifact_JsonCodec.lazyInstance.value) {
            return Artifact_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifactId": value.artifactId,
            "name": value.name,
            "kind": ArtifactKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
            "visibility": Visibility_JsonCodec.instance.encode(BaboonCodecContext.Default, value.visibility),
            "state": ArtifactState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.state),
            "createdByUser": value.createdByUser,
            "createdAt": value.createdAt,
            "expiresAt": value.expiresAt === undefined ? null : value.expiresAt,
            "totalBytes": value.totalBytes.toString(),
            "fileCount": value.fileCount,
            "contentUrl": value.contentUrl,
        };
    }
    decode(ctx, json) {
        if (this !== Artifact_JsonCodec.lazyInstance.value) {
            return Artifact_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Artifact(obj["artifactId"], obj["name"], ArtifactKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]), Visibility_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["visibility"]), ArtifactState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]), obj["createdByUser"], obj["createdAt"], obj["expiresAt"] === undefined || obj["expiresAt"] === null ? undefined : obj["expiresAt"] === undefined || obj["expiresAt"] === null ? undefined : obj["expiresAt"], BaboonInt64.read(obj["totalBytes"], "i64/u64"), obj["fileCount"], obj["contentUrl"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Artifact_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Artifact_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#Artifact';
    baboonTypeIdentifier() {
        return Artifact_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Artifact_JsonCodec());
    static get instance() {
        return Artifact_JsonCodec.lazyInstance.value;
    }
}
