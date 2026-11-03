import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { PrincipalType_JsonCodec } from './PrincipalType.js';
export class Principal {
    _userId;
    _tokenId;
    _principalType;
    constructor(userId, tokenId, principalType) {
        this._userId = userId;
        this._tokenId = tokenId;
        this._principalType = principalType;
    }
    get userId() {
        return this._userId;
    }
    get tokenId() {
        return this._tokenId;
    }
    get principalType() {
        return this._principalType;
    }
    toJSON() {
        return {
            userId: this._userId,
            tokenId: this._tokenId,
            principalType: this._principalType
        };
    }
    with(overrides) {
        return new Principal('userId' in overrides ? overrides.userId : this._userId, 'tokenId' in overrides ? overrides.tokenId : this._tokenId, 'principalType' in overrides ? overrides.principalType : this._principalType);
    }
    static fromPlain(obj) {
        return new Principal(obj.userId, obj.tokenId, obj.principalType);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Principal.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Principal.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#Principal';
    baboonTypeIdentifier() {
        return Principal.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Principal.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Principal.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Principal.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return Principal_JsonCodec.instance;
    }
}
export class Principal_JsonCodec {
    encode(ctx, value) {
        if (this !== Principal_JsonCodec.lazyInstance.value) {
            return Principal_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "userId": value.userId,
            "tokenId": value.tokenId,
            "principalType": PrincipalType_JsonCodec.instance.encode(BaboonCodecContext.Default, value.principalType),
        };
    }
    decode(ctx, json) {
        if (this !== Principal_JsonCodec.lazyInstance.value) {
            return Principal_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Principal(obj["userId"], obj["tokenId"], PrincipalType_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["principalType"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Principal_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Principal_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#Principal';
    baboonTypeIdentifier() {
        return Principal_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Principal_JsonCodec());
    static get instance() {
        return Principal_JsonCodec.lazyInstance.value;
    }
}
