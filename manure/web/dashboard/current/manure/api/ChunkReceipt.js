import { BaboonInt64, Lazy } from '../../BaboonSharedRuntime.js';
export class ChunkReceipt {
    _path;
    _offset;
    _length;
    _receivedBytes;
    constructor(path, offset, length, receivedBytes) {
        this._path = path;
        this._offset = offset;
        this._length = length;
        this._receivedBytes = receivedBytes;
    }
    get path() {
        return this._path;
    }
    get offset() {
        return this._offset;
    }
    get length() {
        return this._length;
    }
    get receivedBytes() {
        return this._receivedBytes;
    }
    toJSON() {
        return {
            path: this._path,
            offset: this._offset,
            length: this._length,
            receivedBytes: this._receivedBytes
        };
    }
    with(overrides) {
        return new ChunkReceipt('path' in overrides ? overrides.path : this._path, 'offset' in overrides ? overrides.offset : this._offset, 'length' in overrides ? overrides.length : this._length, 'receivedBytes' in overrides ? overrides.receivedBytes : this._receivedBytes);
    }
    static fromPlain(obj) {
        return new ChunkReceipt(obj.path, obj.offset, obj.length, obj.receivedBytes);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ChunkReceipt.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ChunkReceipt.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ChunkReceipt';
    baboonTypeIdentifier() {
        return ChunkReceipt.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return ChunkReceipt.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return ChunkReceipt.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return ChunkReceipt.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return ChunkReceipt_JsonCodec.instance;
    }
}
export class ChunkReceipt_JsonCodec {
    encode(ctx, value) {
        if (this !== ChunkReceipt_JsonCodec.lazyInstance.value) {
            return ChunkReceipt_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "path": value.path,
            "offset": value.offset.toString(),
            "length": value.length,
            "receivedBytes": value.receivedBytes.toString(),
        };
    }
    decode(ctx, json) {
        if (this !== ChunkReceipt_JsonCodec.lazyInstance.value) {
            return ChunkReceipt_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new ChunkReceipt(obj["path"], BaboonInt64.read(obj["offset"], "i64/u64"), obj["length"], BaboonInt64.read(obj["receivedBytes"], "i64/u64"));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ChunkReceipt_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ChunkReceipt_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ChunkReceipt';
    baboonTypeIdentifier() {
        return ChunkReceipt_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ChunkReceipt_JsonCodec());
    static get instance() {
        return ChunkReceipt_JsonCodec.lazyInstance.value;
    }
}
