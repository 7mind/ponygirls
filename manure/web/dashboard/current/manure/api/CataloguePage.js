import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { Artifact_JsonCodec } from './Artifact.js';
export class CataloguePage {
    _artifacts;
    _nextCursor;
    constructor(artifacts, nextCursor) {
        this._artifacts = artifacts;
        this._nextCursor = nextCursor;
    }
    get artifacts() {
        return this._artifacts;
    }
    get nextCursor() {
        return this._nextCursor;
    }
    toJSON() {
        return {
            artifacts: this._artifacts,
            nextCursor: this._nextCursor !== undefined ? this._nextCursor : undefined
        };
    }
    with(overrides) {
        return new CataloguePage('artifacts' in overrides ? overrides.artifacts : this._artifacts, 'nextCursor' in overrides ? overrides.nextCursor : this._nextCursor);
    }
    static fromPlain(obj) {
        return new CataloguePage(obj.artifacts, obj.nextCursor);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return CataloguePage.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return CataloguePage.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#CataloguePage';
    baboonTypeIdentifier() {
        return CataloguePage.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return CataloguePage.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return CataloguePage.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return CataloguePage.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return CataloguePage_JsonCodec.instance;
    }
}
export class CataloguePage_JsonCodec {
    encode(ctx, value) {
        if (this !== CataloguePage_JsonCodec.lazyInstance.value) {
            return CataloguePage_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifacts": Array.from(value.artifacts).map(item => Artifact_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "nextCursor": value.nextCursor === undefined ? null : value.nextCursor,
        };
    }
    decode(ctx, json) {
        if (this !== CataloguePage_JsonCodec.lazyInstance.value) {
            return CataloguePage_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new CataloguePage(obj["artifacts"].map(item => Artifact_JsonCodec.instance.decode(BaboonCodecContext.Default, item)), obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return CataloguePage_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return CataloguePage_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#CataloguePage';
    baboonTypeIdentifier() {
        return CataloguePage_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new CataloguePage_JsonCodec());
    static get instance() {
        return CataloguePage_JsonCodec.lazyInstance.value;
    }
}
