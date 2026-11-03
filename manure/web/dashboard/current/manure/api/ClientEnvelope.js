import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { Command_JsonCodec } from './Command.js';
export class ClientEnvelope {
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
        return new ClientEnvelope('requestId' in overrides ? overrides.requestId : this._requestId, 'apiVersion' in overrides ? overrides.apiVersion : this._apiVersion, 'command' in overrides ? overrides.command : this._command);
    }
    static fromPlain(obj) {
        return new ClientEnvelope(obj.requestId, obj.apiVersion, obj.command);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ClientEnvelope.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ClientEnvelope.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ClientEnvelope';
    baboonTypeIdentifier() {
        return ClientEnvelope.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return ClientEnvelope.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return ClientEnvelope.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return ClientEnvelope.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return ClientEnvelope_JsonCodec.instance;
    }
}
export class ClientEnvelope_JsonCodec {
    encode(ctx, value) {
        if (this !== ClientEnvelope_JsonCodec.lazyInstance.value) {
            return ClientEnvelope_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "requestId": value.requestId,
            "apiVersion": value.apiVersion,
            "command": Command_JsonCodec.instance.encode(BaboonCodecContext.Default, value.command),
        };
    }
    decode(ctx, json) {
        if (this !== ClientEnvelope_JsonCodec.lazyInstance.value) {
            return ClientEnvelope_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new ClientEnvelope(obj["requestId"], obj["apiVersion"], Command_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["command"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ClientEnvelope_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ClientEnvelope_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ClientEnvelope';
    baboonTypeIdentifier() {
        return ClientEnvelope_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ClientEnvelope_JsonCodec());
    static get instance() {
        return ClientEnvelope_JsonCodec.lazyInstance.value;
    }
}
