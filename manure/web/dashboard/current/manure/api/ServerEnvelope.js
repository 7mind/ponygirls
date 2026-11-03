import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { Result_JsonCodec } from './Result.js';
export class ServerEnvelope {
    _requestId;
    _result;
    constructor(requestId, result) {
        this._requestId = requestId;
        this._result = result;
    }
    get requestId() {
        return this._requestId;
    }
    get result() {
        return this._result;
    }
    toJSON() {
        return {
            requestId: this._requestId,
            result: this._result
        };
    }
    with(overrides) {
        return new ServerEnvelope('requestId' in overrides ? overrides.requestId : this._requestId, 'result' in overrides ? overrides.result : this._result);
    }
    static fromPlain(obj) {
        return new ServerEnvelope(obj.requestId, obj.result);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ServerEnvelope.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ServerEnvelope.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ServerEnvelope';
    baboonTypeIdentifier() {
        return ServerEnvelope.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return ServerEnvelope.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return ServerEnvelope.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return ServerEnvelope.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return ServerEnvelope_JsonCodec.instance;
    }
}
export class ServerEnvelope_JsonCodec {
    encode(ctx, value) {
        if (this !== ServerEnvelope_JsonCodec.lazyInstance.value) {
            return ServerEnvelope_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "requestId": value.requestId,
            "result": Result_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
        };
    }
    decode(ctx, json) {
        if (this !== ServerEnvelope_JsonCodec.lazyInstance.value) {
            return ServerEnvelope_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new ServerEnvelope(obj["requestId"], Result_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ServerEnvelope_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ServerEnvelope_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ServerEnvelope';
    baboonTypeIdentifier() {
        return ServerEnvelope_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ServerEnvelope_JsonCodec());
    static get instance() {
        return ServerEnvelope_JsonCodec.lazyInstance.value;
    }
}
