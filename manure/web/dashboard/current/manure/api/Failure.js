import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { ErrorCode_JsonCodec } from './ErrorCode.js';
export class Failure {
    _code;
    _message;
    _retryAfterSeconds;
    constructor(code, message, retryAfterSeconds) {
        this._code = code;
        this._message = message;
        this._retryAfterSeconds = retryAfterSeconds;
    }
    get code() {
        return this._code;
    }
    get message() {
        return this._message;
    }
    get retryAfterSeconds() {
        return this._retryAfterSeconds;
    }
    toJSON() {
        return {
            code: this._code,
            message: this._message,
            retryAfterSeconds: this._retryAfterSeconds !== undefined ? this._retryAfterSeconds : undefined
        };
    }
    with(overrides) {
        return new Failure('code' in overrides ? overrides.code : this._code, 'message' in overrides ? overrides.message : this._message, 'retryAfterSeconds' in overrides ? overrides.retryAfterSeconds : this._retryAfterSeconds);
    }
    static fromPlain(obj) {
        return new Failure(obj.code, obj.message, obj.retryAfterSeconds);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Failure.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Failure.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#Failure';
    baboonTypeIdentifier() {
        return Failure.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Failure.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Failure.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Failure.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return Failure_JsonCodec.instance;
    }
}
export class Failure_JsonCodec {
    encode(ctx, value) {
        if (this !== Failure_JsonCodec.lazyInstance.value) {
            return Failure_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "code": ErrorCode_JsonCodec.instance.encode(BaboonCodecContext.Default, value.code),
            "message": value.message,
            "retryAfterSeconds": value.retryAfterSeconds === undefined ? null : value.retryAfterSeconds,
        };
    }
    decode(ctx, json) {
        if (this !== Failure_JsonCodec.lazyInstance.value) {
            return Failure_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Failure(ErrorCode_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["code"]), obj["message"], obj["retryAfterSeconds"] === undefined || obj["retryAfterSeconds"] === null ? undefined : obj["retryAfterSeconds"] === undefined || obj["retryAfterSeconds"] === null ? undefined : obj["retryAfterSeconds"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Failure_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Failure_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#Failure';
    baboonTypeIdentifier() {
        return Failure_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Failure_JsonCodec());
    static get instance() {
        return Failure_JsonCodec.lazyInstance.value;
    }
}
