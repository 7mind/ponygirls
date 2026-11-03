import { BaboonCodecContext, BaboonInt64, Lazy } from '../../BaboonSharedRuntime.js';
import { ByteRange_JsonCodec } from './ByteRange.js';
export class FileProgress {
    _path;
    _size;
    _receivedBytes;
    _receivedRanges;
    constructor(path, size, receivedBytes, receivedRanges) {
        this._path = path;
        this._size = size;
        this._receivedBytes = receivedBytes;
        this._receivedRanges = receivedRanges;
    }
    get path() {
        return this._path;
    }
    get size() {
        return this._size;
    }
    get receivedBytes() {
        return this._receivedBytes;
    }
    get receivedRanges() {
        return this._receivedRanges;
    }
    toJSON() {
        return {
            path: this._path,
            size: this._size,
            receivedBytes: this._receivedBytes,
            receivedRanges: this._receivedRanges
        };
    }
    with(overrides) {
        return new FileProgress('path' in overrides ? overrides.path : this._path, 'size' in overrides ? overrides.size : this._size, 'receivedBytes' in overrides ? overrides.receivedBytes : this._receivedBytes, 'receivedRanges' in overrides ? overrides.receivedRanges : this._receivedRanges);
    }
    static fromPlain(obj) {
        return new FileProgress(obj.path, obj.size, obj.receivedBytes, obj.receivedRanges);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return FileProgress.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return FileProgress.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#FileProgress';
    baboonTypeIdentifier() {
        return FileProgress.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return FileProgress.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return FileProgress.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return FileProgress.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return FileProgress_JsonCodec.instance;
    }
}
export class FileProgress_JsonCodec {
    encode(ctx, value) {
        if (this !== FileProgress_JsonCodec.lazyInstance.value) {
            return FileProgress_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "path": value.path,
            "size": value.size.toString(),
            "receivedBytes": value.receivedBytes.toString(),
            "receivedRanges": Array.from(value.receivedRanges).map(item => ByteRange_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        };
    }
    decode(ctx, json) {
        if (this !== FileProgress_JsonCodec.lazyInstance.value) {
            return FileProgress_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new FileProgress(obj["path"], BaboonInt64.read(obj["size"], "i64/u64"), BaboonInt64.read(obj["receivedBytes"], "i64/u64"), obj["receivedRanges"].map(item => ByteRange_JsonCodec.instance.decode(BaboonCodecContext.Default, item)));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return FileProgress_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return FileProgress_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#FileProgress';
    baboonTypeIdentifier() {
        return FileProgress_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new FileProgress_JsonCodec());
    static get instance() {
        return FileProgress_JsonCodec.lazyInstance.value;
    }
}
