import { BaboonInt64, Lazy } from '../../BaboonSharedRuntime.js';
export class ByteRange {
    _start;
    _endExclusive;
    constructor(start, endExclusive) {
        this._start = start;
        this._endExclusive = endExclusive;
    }
    get start() {
        return this._start;
    }
    get endExclusive() {
        return this._endExclusive;
    }
    toJSON() {
        return {
            start: this._start,
            endExclusive: this._endExclusive
        };
    }
    with(overrides) {
        return new ByteRange('start' in overrides ? overrides.start : this._start, 'endExclusive' in overrides ? overrides.endExclusive : this._endExclusive);
    }
    static fromPlain(obj) {
        return new ByteRange(obj.start, obj.endExclusive);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ByteRange.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ByteRange.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ByteRange';
    baboonTypeIdentifier() {
        return ByteRange.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return ByteRange.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return ByteRange.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return ByteRange.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return ByteRange_JsonCodec.instance;
    }
}
export class ByteRange_JsonCodec {
    encode(ctx, value) {
        if (this !== ByteRange_JsonCodec.lazyInstance.value) {
            return ByteRange_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "start": value.start.toString(),
            "endExclusive": value.endExclusive.toString(),
        };
    }
    decode(ctx, json) {
        if (this !== ByteRange_JsonCodec.lazyInstance.value) {
            return ByteRange_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new ByteRange(BaboonInt64.read(obj["start"], "i64/u64"), BaboonInt64.read(obj["endExclusive"], "i64/u64"));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ByteRange_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ByteRange_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ByteRange';
    baboonTypeIdentifier() {
        return ByteRange_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ByteRange_JsonCodec());
    static get instance() {
        return ByteRange_JsonCodec.lazyInstance.value;
    }
}
