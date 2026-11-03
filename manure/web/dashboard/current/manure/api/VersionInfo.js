import { Lazy } from '../../BaboonSharedRuntime.js';
export class VersionInfo {
    _current;
    _supported;
    constructor(current, supported) {
        this._current = current;
        this._supported = supported;
    }
    get current() {
        return this._current;
    }
    get supported() {
        return this._supported;
    }
    toJSON() {
        return {
            current: this._current,
            supported: this._supported
        };
    }
    with(overrides) {
        return new VersionInfo('current' in overrides ? overrides.current : this._current, 'supported' in overrides ? overrides.supported : this._supported);
    }
    static fromPlain(obj) {
        return new VersionInfo(obj.current, obj.supported);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return VersionInfo.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return VersionInfo.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#VersionInfo';
    baboonTypeIdentifier() {
        return VersionInfo.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return VersionInfo.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return VersionInfo.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return VersionInfo.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return VersionInfo_JsonCodec.instance;
    }
}
export class VersionInfo_JsonCodec {
    encode(ctx, value) {
        if (this !== VersionInfo_JsonCodec.lazyInstance.value) {
            return VersionInfo_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "current": value.current,
            "supported": Array.from(value.supported),
        };
    }
    decode(ctx, json) {
        if (this !== VersionInfo_JsonCodec.lazyInstance.value) {
            return VersionInfo_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new VersionInfo(obj["current"], obj["supported"].map(item => item));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return VersionInfo_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return VersionInfo_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#VersionInfo';
    baboonTypeIdentifier() {
        return VersionInfo_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new VersionInfo_JsonCodec());
    static get instance() {
        return VersionInfo_JsonCodec.lazyInstance.value;
    }
}
