import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { ContentCommand_JsonCodec } from './ContentCommand.js';
export class ContentEnvelope {
    _requestId;
    _apiVersion;
    _command;
    constructor(requestId, apiVersion, command) {
        this._requestId = requestId;
        this._apiVersion = apiVersion;
        this._command = command;
    }
    get requestId() {
        return this._requestId;
    }
    get apiVersion() {
        return this._apiVersion;
    }
    get command() {
        return this._command;
    }
    toJSON() {
        return {
            requestId: this._requestId,
            apiVersion: this._apiVersion,
            command: this._command
        };
    }
    with(overrides) {
        return new ContentEnvelope('requestId' in overrides ? overrides.requestId : this._requestId, 'apiVersion' in overrides ? overrides.apiVersion : this._apiVersion, 'command' in overrides ? overrides.command : this._command);
    }
    static fromPlain(obj) {
        return new ContentEnvelope(obj.requestId, obj.apiVersion, obj.command);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ContentEnvelope.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ContentEnvelope.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ContentEnvelope';
    baboonTypeIdentifier() {
        return ContentEnvelope.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return ContentEnvelope.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return ContentEnvelope.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return ContentEnvelope.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return ContentEnvelope_JsonCodec.instance;
    }
}
export class ContentEnvelope_JsonCodec {
    encode(ctx, value) {
        if (this !== ContentEnvelope_JsonCodec.lazyInstance.value) {
            return ContentEnvelope_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "requestId": value.requestId,
            "apiVersion": value.apiVersion,
            "command": ContentCommand_JsonCodec.instance.encode(BaboonCodecContext.Default, value.command),
        };
    }
    decode(ctx, json) {
        if (this !== ContentEnvelope_JsonCodec.lazyInstance.value) {
            return ContentEnvelope_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new ContentEnvelope(obj["requestId"], obj["apiVersion"], ContentCommand_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["command"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ContentEnvelope_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ContentEnvelope_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ContentEnvelope';
    baboonTypeIdentifier() {
        return ContentEnvelope_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ContentEnvelope_JsonCodec());
    static get instance() {
        return ContentEnvelope_JsonCodec.lazyInstance.value;
    }
}
