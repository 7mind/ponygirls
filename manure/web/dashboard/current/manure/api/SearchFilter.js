import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { ArtifactKind_JsonCodec } from './ArtifactKind.js';
import { Visibility_JsonCodec } from './Visibility.js';
export class SearchFilter {
    _visibility;
    _kind;
    _createdByUser;
    _tags;
    _hostname;
    _projectPath;
    constructor(visibility, kind, createdByUser, tags, hostname, projectPath) {
        this._visibility = visibility;
        this._kind = kind;
        this._createdByUser = createdByUser;
        this._tags = tags;
        this._hostname = hostname;
        this._projectPath = projectPath;
    }
    get visibility() {
        return this._visibility;
    }
    get kind() {
        return this._kind;
    }
    get createdByUser() {
        return this._createdByUser;
    }
    get tags() {
        return this._tags;
    }
    get hostname() {
        return this._hostname;
    }
    get projectPath() {
        return this._projectPath;
    }
    toJSON() {
        return {
            visibility: this._visibility !== undefined ? this._visibility : undefined,
            kind: this._kind !== undefined ? this._kind : undefined,
            createdByUser: this._createdByUser !== undefined ? this._createdByUser : undefined,
            tags: this._tags,
            hostname: this._hostname !== undefined ? this._hostname : undefined,
            projectPath: this._projectPath !== undefined ? this._projectPath : undefined
        };
    }
    with(overrides) {
        return new SearchFilter('visibility' in overrides ? overrides.visibility : this._visibility, 'kind' in overrides ? overrides.kind : this._kind, 'createdByUser' in overrides ? overrides.createdByUser : this._createdByUser, 'tags' in overrides ? overrides.tags : this._tags, 'hostname' in overrides ? overrides.hostname : this._hostname, 'projectPath' in overrides ? overrides.projectPath : this._projectPath);
    }
    static fromPlain(obj) {
        return new SearchFilter(obj.visibility, obj.kind, obj.createdByUser, obj.tags, obj.hostname, obj.projectPath);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return SearchFilter.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return SearchFilter.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#SearchFilter';
    baboonTypeIdentifier() {
        return SearchFilter.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return SearchFilter.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return SearchFilter.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return SearchFilter.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return SearchFilter_JsonCodec.instance;
    }
}
export class SearchFilter_JsonCodec {
    encode(ctx, value) {
        if (this !== SearchFilter_JsonCodec.lazyInstance.value) {
            return SearchFilter_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "visibility": value.visibility === undefined ? null : Visibility_JsonCodec.instance.encode(BaboonCodecContext.Default, value.visibility),
            "kind": value.kind === undefined ? null : ArtifactKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
            "createdByUser": value.createdByUser === undefined ? null : value.createdByUser,
            "tags": Array.from(value.tags),
            "hostname": value.hostname === undefined ? null : value.hostname,
            "projectPath": value.projectPath === undefined ? null : value.projectPath,
        };
    }
    decode(ctx, json) {
        if (this !== SearchFilter_JsonCodec.lazyInstance.value) {
            return SearchFilter_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new SearchFilter(obj["visibility"] === undefined || obj["visibility"] === null ? undefined : obj["visibility"] === undefined || obj["visibility"] === null ? undefined : Visibility_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["visibility"]), obj["kind"] === undefined || obj["kind"] === null ? undefined : obj["kind"] === undefined || obj["kind"] === null ? undefined : ArtifactKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]), obj["createdByUser"] === undefined || obj["createdByUser"] === null ? undefined : obj["createdByUser"] === undefined || obj["createdByUser"] === null ? undefined : obj["createdByUser"], obj["tags"].map(item => item), obj["hostname"] === undefined || obj["hostname"] === null ? undefined : obj["hostname"] === undefined || obj["hostname"] === null ? undefined : obj["hostname"], obj["projectPath"] === undefined || obj["projectPath"] === null ? undefined : obj["projectPath"] === undefined || obj["projectPath"] === null ? undefined : obj["projectPath"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return SearchFilter_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return SearchFilter_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#SearchFilter';
    baboonTypeIdentifier() {
        return SearchFilter_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new SearchFilter_JsonCodec());
    static get instance() {
        return SearchFilter_JsonCodec.lazyInstance.value;
    }
}
