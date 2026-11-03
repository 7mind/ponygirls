import { BaboonCodecContext, BaboonInt64, Lazy } from '../../BaboonSharedRuntime.js';
export const ManifestEntry = {
    BaboonDomainVersion: '1.0.0',
    BaboonDomainIdentifier: 'manure.api',
    BaboonTypeIdentifier: 'manure.api/:#ManifestEntry',
    BaboonSameInVersions: ["1.0.0"],
    BaboonForwardReadable: { "1.0.0": "identical" },
    BaboonMinReaderVersions: { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" },
    BaboonAdtTypeIdentifier: 'manure.api/:#ManifestEntry',
    jsonCodec() {
        return ManifestEntry_JsonCodec.instance;
    }
};
export class ManifestEntry_File {
    $type = 'manure.api/[manure.api/:#ManifestEntry]#File';
    _path;
    _size;
    _sha256;
    constructor(path, size, sha256) {
        this._path = path;
        this._size = size;
        this._sha256 = sha256;
    }
    get path() {
        return this._path;
    }
    get size() {
        return this._size;
    }
    get sha256() {
        return this._sha256;
    }
    toJSON() {
        return {
            path: this._path,
            size: this._size,
            sha256: this._sha256
        };
    }
    with(overrides) {
        return new ManifestEntry_File('path' in overrides ? overrides.path : this._path, 'size' in overrides ? overrides.size : this._size, 'sha256' in overrides ? overrides.sha256 : this._sha256);
    }
    static fromPlain(obj) {
        return new ManifestEntry_File(obj.path, obj.size, obj.sha256);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ManifestEntry_File.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ManifestEntry_File.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ManifestEntry]#File';
    baboonTypeIdentifier() {
        return ManifestEntry_File.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return ManifestEntry_File.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return ManifestEntry_File.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return ManifestEntry_File.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ManifestEntry';
    baboonAdtTypeIdentifier() {
        return ManifestEntry_File.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return ManifestEntry_File_JsonCodec.instance;
    }
}
export class ManifestEntry_File_JsonCodec {
    encode(ctx, value) {
        if (this !== ManifestEntry_File_JsonCodec.lazyInstance.value) {
            return ManifestEntry_File_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "path": value.path,
            "size": value.size.toString(),
            "sha256": value.sha256,
        };
    }
    decode(ctx, json) {
        if (this !== ManifestEntry_File_JsonCodec.lazyInstance.value) {
            return ManifestEntry_File_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new ManifestEntry_File(obj["path"], BaboonInt64.read(obj["size"], "i64/u64"), obj["sha256"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ManifestEntry_File_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ManifestEntry_File_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ManifestEntry]#File';
    baboonTypeIdentifier() {
        return ManifestEntry_File_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ManifestEntry';
    baboonAdtTypeIdentifier() {
        return ManifestEntry_File_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ManifestEntry_File_JsonCodec());
    static get instance() {
        return ManifestEntry_File_JsonCodec.lazyInstance.value;
    }
}
export class ManifestEntry_Directory {
    $type = 'manure.api/[manure.api/:#ManifestEntry]#Directory';
    _path;
    constructor(path) {
        this._path = path;
    }
    get path() {
        return this._path;
    }
    toJSON() {
        return {
            path: this._path
        };
    }
    with(overrides) {
        return new ManifestEntry_Directory('path' in overrides ? overrides.path : this._path);
    }
    static fromPlain(obj) {
        return new ManifestEntry_Directory(obj.path);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ManifestEntry_Directory.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ManifestEntry_Directory.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ManifestEntry]#Directory';
    baboonTypeIdentifier() {
        return ManifestEntry_Directory.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return ManifestEntry_Directory.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return ManifestEntry_Directory.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return ManifestEntry_Directory.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ManifestEntry';
    baboonAdtTypeIdentifier() {
        return ManifestEntry_Directory.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return ManifestEntry_Directory_JsonCodec.instance;
    }
}
export class ManifestEntry_Directory_JsonCodec {
    encode(ctx, value) {
        if (this !== ManifestEntry_Directory_JsonCodec.lazyInstance.value) {
            return ManifestEntry_Directory_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "path": value.path,
        };
    }
    decode(ctx, json) {
        if (this !== ManifestEntry_Directory_JsonCodec.lazyInstance.value) {
            return ManifestEntry_Directory_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new ManifestEntry_Directory(obj["path"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ManifestEntry_Directory_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ManifestEntry_Directory_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ManifestEntry]#Directory';
    baboonTypeIdentifier() {
        return ManifestEntry_Directory_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ManifestEntry';
    baboonAdtTypeIdentifier() {
        return ManifestEntry_Directory_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ManifestEntry_Directory_JsonCodec());
    static get instance() {
        return ManifestEntry_Directory_JsonCodec.lazyInstance.value;
    }
}
export class ManifestEntry_JsonCodec {
    encode(ctx, value) {
        if (this !== ManifestEntry_JsonCodec.lazyInstance.value) {
            return ManifestEntry_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        if (value instanceof ManifestEntry_File) {
            return { "File": ManifestEntry_File_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof ManifestEntry_Directory) {
            return { "Directory": ManifestEntry_Directory_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        throw new Error("Unhandled ADT branch: " + value.constructor?.name);
    }
    decode(ctx, json) {
        if (this !== ManifestEntry_JsonCodec.lazyInstance.value) {
            return ManifestEntry_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "File": return ManifestEntry_File_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "Directory": return ManifestEntry_Directory_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ManifestEntry_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ManifestEntry_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ManifestEntry';
    baboonTypeIdentifier() {
        return ManifestEntry_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ManifestEntry';
    baboonAdtTypeIdentifier() {
        return ManifestEntry_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ManifestEntry_JsonCodec());
    static get instance() {
        return ManifestEntry_JsonCodec.lazyInstance.value;
    }
}
