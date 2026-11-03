import { BaboonCodecContext, BaboonInt64, Lazy } from '../../BaboonSharedRuntime.js';
import { ContentMode_JsonCodec } from './ContentMode.js';
import { SearchMode_JsonCodec } from './SearchMode.js';
export class Capabilities {
    _contentMode;
    _searchModes;
    _metadataOnlySearch;
    _chunkBytes;
    _maxListLimit;
    _maxRequestBodyBytes;
    _maxFileBytes;
    _maxArtifactBytes;
    _maxFilesPerArtifact;
    _maxTtlSeconds;
    _cataloguePolicy;
    constructor(contentMode, searchModes, metadataOnlySearch, chunkBytes, maxListLimit, maxRequestBodyBytes, maxFileBytes, maxArtifactBytes, maxFilesPerArtifact, maxTtlSeconds, cataloguePolicy) {
        this._contentMode = contentMode;
        this._searchModes = searchModes;
        this._metadataOnlySearch = metadataOnlySearch;
        this._chunkBytes = chunkBytes;
        this._maxListLimit = maxListLimit;
        this._maxRequestBodyBytes = maxRequestBodyBytes;
        this._maxFileBytes = maxFileBytes;
        this._maxArtifactBytes = maxArtifactBytes;
        this._maxFilesPerArtifact = maxFilesPerArtifact;
        this._maxTtlSeconds = maxTtlSeconds;
        this._cataloguePolicy = cataloguePolicy;
    }
    get contentMode() {
        return this._contentMode;
    }
    get searchModes() {
        return this._searchModes;
    }
    get metadataOnlySearch() {
        return this._metadataOnlySearch;
    }
    get chunkBytes() {
        return this._chunkBytes;
    }
    get maxListLimit() {
        return this._maxListLimit;
    }
    get maxRequestBodyBytes() {
        return this._maxRequestBodyBytes;
    }
    get maxFileBytes() {
        return this._maxFileBytes;
    }
    get maxArtifactBytes() {
        return this._maxArtifactBytes;
    }
    get maxFilesPerArtifact() {
        return this._maxFilesPerArtifact;
    }
    get maxTtlSeconds() {
        return this._maxTtlSeconds;
    }
    get cataloguePolicy() {
        return this._cataloguePolicy;
    }
    toJSON() {
        return {
            contentMode: this._contentMode,
            searchModes: this._searchModes,
            metadataOnlySearch: this._metadataOnlySearch,
            chunkBytes: this._chunkBytes,
            maxListLimit: this._maxListLimit,
            maxRequestBodyBytes: this._maxRequestBodyBytes,
            maxFileBytes: this._maxFileBytes,
            maxArtifactBytes: this._maxArtifactBytes,
            maxFilesPerArtifact: this._maxFilesPerArtifact,
            maxTtlSeconds: this._maxTtlSeconds,
            cataloguePolicy: this._cataloguePolicy
        };
    }
    with(overrides) {
        return new Capabilities('contentMode' in overrides ? overrides.contentMode : this._contentMode, 'searchModes' in overrides ? overrides.searchModes : this._searchModes, 'metadataOnlySearch' in overrides ? overrides.metadataOnlySearch : this._metadataOnlySearch, 'chunkBytes' in overrides ? overrides.chunkBytes : this._chunkBytes, 'maxListLimit' in overrides ? overrides.maxListLimit : this._maxListLimit, 'maxRequestBodyBytes' in overrides ? overrides.maxRequestBodyBytes : this._maxRequestBodyBytes, 'maxFileBytes' in overrides ? overrides.maxFileBytes : this._maxFileBytes, 'maxArtifactBytes' in overrides ? overrides.maxArtifactBytes : this._maxArtifactBytes, 'maxFilesPerArtifact' in overrides ? overrides.maxFilesPerArtifact : this._maxFilesPerArtifact, 'maxTtlSeconds' in overrides ? overrides.maxTtlSeconds : this._maxTtlSeconds, 'cataloguePolicy' in overrides ? overrides.cataloguePolicy : this._cataloguePolicy);
    }
    static fromPlain(obj) {
        return new Capabilities(obj.contentMode, obj.searchModes, obj.metadataOnlySearch, obj.chunkBytes, obj.maxListLimit, obj.maxRequestBodyBytes, obj.maxFileBytes, obj.maxArtifactBytes, obj.maxFilesPerArtifact, obj.maxTtlSeconds, obj.cataloguePolicy);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Capabilities.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Capabilities.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#Capabilities';
    baboonTypeIdentifier() {
        return Capabilities.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Capabilities.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Capabilities.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Capabilities.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return Capabilities_JsonCodec.instance;
    }
}
export class Capabilities_JsonCodec {
    encode(ctx, value) {
        if (this !== Capabilities_JsonCodec.lazyInstance.value) {
            return Capabilities_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "contentMode": ContentMode_JsonCodec.instance.encode(BaboonCodecContext.Default, value.contentMode),
            "searchModes": Array.from(value.searchModes).map(item => SearchMode_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "metadataOnlySearch": value.metadataOnlySearch,
            "chunkBytes": value.chunkBytes,
            "maxListLimit": value.maxListLimit,
            "maxRequestBodyBytes": value.maxRequestBodyBytes.toString(),
            "maxFileBytes": value.maxFileBytes.toString(),
            "maxArtifactBytes": value.maxArtifactBytes.toString(),
            "maxFilesPerArtifact": value.maxFilesPerArtifact,
            "maxTtlSeconds": value.maxTtlSeconds,
            "cataloguePolicy": value.cataloguePolicy,
        };
    }
    decode(ctx, json) {
        if (this !== Capabilities_JsonCodec.lazyInstance.value) {
            return Capabilities_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Capabilities(ContentMode_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["contentMode"]), obj["searchModes"].map(item => SearchMode_JsonCodec.instance.decode(BaboonCodecContext.Default, item)), obj["metadataOnlySearch"], obj["chunkBytes"], obj["maxListLimit"], BaboonInt64.read(obj["maxRequestBodyBytes"], "i64/u64"), BaboonInt64.read(obj["maxFileBytes"], "i64/u64"), BaboonInt64.read(obj["maxArtifactBytes"], "i64/u64"), obj["maxFilesPerArtifact"], obj["maxTtlSeconds"], obj["cataloguePolicy"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Capabilities_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Capabilities_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#Capabilities';
    baboonTypeIdentifier() {
        return Capabilities_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Capabilities_JsonCodec());
    static get instance() {
        return Capabilities_JsonCodec.lazyInstance.value;
    }
}
