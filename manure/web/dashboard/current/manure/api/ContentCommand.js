import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
export const ContentCommand = {
    BaboonDomainVersion: '1.0.0',
    BaboonDomainIdentifier: 'manure.api',
    BaboonTypeIdentifier: 'manure.api/:#ContentCommand',
    BaboonSameInVersions: ["1.0.0"],
    BaboonForwardReadable: { "1.0.0": "identical" },
    BaboonMinReaderVersions: { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" },
    BaboonAdtTypeIdentifier: 'manure.api/:#ContentCommand',
    jsonCodec() {
        return ContentCommand_JsonCodec.instance;
    }
};
export class ContentCommand_Unlock {
    $type = 'manure.api/[manure.api/:#ContentCommand]#Unlock';
    _password;
    constructor(password) {
        this._password = password;
    }
    get password() {
        return this._password;
    }
    toJSON() {
        return {
            password: this._password
        };
    }
    with(overrides) {
        return new ContentCommand_Unlock('password' in overrides ? overrides.password : this._password);
    }
    static fromPlain(obj) {
        return new ContentCommand_Unlock(obj.password);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ContentCommand_Unlock.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ContentCommand_Unlock.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#Unlock';
    baboonTypeIdentifier() {
        return ContentCommand_Unlock.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return ContentCommand_Unlock.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return ContentCommand_Unlock.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return ContentCommand_Unlock.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand';
    baboonAdtTypeIdentifier() {
        return ContentCommand_Unlock.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return ContentCommand_Unlock_JsonCodec.instance;
    }
}
export class ContentCommand_Unlock_JsonCodec {
    encode(ctx, value) {
        if (this !== ContentCommand_Unlock_JsonCodec.lazyInstance.value) {
            return ContentCommand_Unlock_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "password": value.password,
        };
    }
    decode(ctx, json) {
        if (this !== ContentCommand_Unlock_JsonCodec.lazyInstance.value) {
            return ContentCommand_Unlock_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new ContentCommand_Unlock(obj["password"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ContentCommand_Unlock_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ContentCommand_Unlock_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#Unlock';
    baboonTypeIdentifier() {
        return ContentCommand_Unlock_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand';
    baboonAdtTypeIdentifier() {
        return ContentCommand_Unlock_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ContentCommand_Unlock_JsonCodec());
    static get instance() {
        return ContentCommand_Unlock_JsonCodec.lazyInstance.value;
    }
}
export class ContentCommand_RedeemGrant {
    $type = 'manure.api/[manure.api/:#ContentCommand]#RedeemGrant';
    _grant;
    constructor(grant) {
        this._grant = grant;
    }
    get grant() {
        return this._grant;
    }
    toJSON() {
        return {
            grant: this._grant
        };
    }
    with(overrides) {
        return new ContentCommand_RedeemGrant('grant' in overrides ? overrides.grant : this._grant);
    }
    static fromPlain(obj) {
        return new ContentCommand_RedeemGrant(obj.grant);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ContentCommand_RedeemGrant.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ContentCommand_RedeemGrant.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#RedeemGrant';
    baboonTypeIdentifier() {
        return ContentCommand_RedeemGrant.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return ContentCommand_RedeemGrant.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return ContentCommand_RedeemGrant.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return ContentCommand_RedeemGrant.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand';
    baboonAdtTypeIdentifier() {
        return ContentCommand_RedeemGrant.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return ContentCommand_RedeemGrant_JsonCodec.instance;
    }
}
export class ContentCommand_RedeemGrant_JsonCodec {
    encode(ctx, value) {
        if (this !== ContentCommand_RedeemGrant_JsonCodec.lazyInstance.value) {
            return ContentCommand_RedeemGrant_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "grant": value.grant,
        };
    }
    decode(ctx, json) {
        if (this !== ContentCommand_RedeemGrant_JsonCodec.lazyInstance.value) {
            return ContentCommand_RedeemGrant_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new ContentCommand_RedeemGrant(obj["grant"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ContentCommand_RedeemGrant_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ContentCommand_RedeemGrant_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#RedeemGrant';
    baboonTypeIdentifier() {
        return ContentCommand_RedeemGrant_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand';
    baboonAdtTypeIdentifier() {
        return ContentCommand_RedeemGrant_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ContentCommand_RedeemGrant_JsonCodec());
    static get instance() {
        return ContentCommand_RedeemGrant_JsonCodec.lazyInstance.value;
    }
}
export class ContentCommand_Logout {
    $type = 'manure.api/[manure.api/:#ContentCommand]#Logout';
    constructor() {
    }
    toJSON() {
        return {};
    }
    with(overrides) {
        return new ContentCommand_Logout();
    }
    static fromPlain(obj) {
        return new ContentCommand_Logout();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ContentCommand_Logout.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ContentCommand_Logout.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#Logout';
    baboonTypeIdentifier() {
        return ContentCommand_Logout.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return ContentCommand_Logout.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return ContentCommand_Logout.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return ContentCommand_Logout.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand';
    baboonAdtTypeIdentifier() {
        return ContentCommand_Logout.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return ContentCommand_Logout_JsonCodec.instance;
    }
}
export class ContentCommand_Logout_JsonCodec {
    encode(ctx, value) {
        if (this !== ContentCommand_Logout_JsonCodec.lazyInstance.value) {
            return ContentCommand_Logout_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {};
    }
    decode(ctx, json) {
        if (this !== ContentCommand_Logout_JsonCodec.lazyInstance.value) {
            return ContentCommand_Logout_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new ContentCommand_Logout();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ContentCommand_Logout_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ContentCommand_Logout_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#Logout';
    baboonTypeIdentifier() {
        return ContentCommand_Logout_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand';
    baboonAdtTypeIdentifier() {
        return ContentCommand_Logout_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ContentCommand_Logout_JsonCodec());
    static get instance() {
        return ContentCommand_Logout_JsonCodec.lazyInstance.value;
    }
}
export class ContentCommand_GetManifest {
    $type = 'manure.api/[manure.api/:#ContentCommand]#GetManifest';
    constructor() {
    }
    toJSON() {
        return {};
    }
    with(overrides) {
        return new ContentCommand_GetManifest();
    }
    static fromPlain(obj) {
        return new ContentCommand_GetManifest();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ContentCommand_GetManifest.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ContentCommand_GetManifest.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#GetManifest';
    baboonTypeIdentifier() {
        return ContentCommand_GetManifest.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return ContentCommand_GetManifest.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return ContentCommand_GetManifest.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return ContentCommand_GetManifest.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand';
    baboonAdtTypeIdentifier() {
        return ContentCommand_GetManifest.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return ContentCommand_GetManifest_JsonCodec.instance;
    }
}
export class ContentCommand_GetManifest_JsonCodec {
    encode(ctx, value) {
        if (this !== ContentCommand_GetManifest_JsonCodec.lazyInstance.value) {
            return ContentCommand_GetManifest_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {};
    }
    decode(ctx, json) {
        if (this !== ContentCommand_GetManifest_JsonCodec.lazyInstance.value) {
            return ContentCommand_GetManifest_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new ContentCommand_GetManifest();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ContentCommand_GetManifest_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ContentCommand_GetManifest_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#GetManifest';
    baboonTypeIdentifier() {
        return ContentCommand_GetManifest_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand';
    baboonAdtTypeIdentifier() {
        return ContentCommand_GetManifest_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ContentCommand_GetManifest_JsonCodec());
    static get instance() {
        return ContentCommand_GetManifest_JsonCodec.lazyInstance.value;
    }
}
export class ContentCommand_JsonCodec {
    encode(ctx, value) {
        if (this !== ContentCommand_JsonCodec.lazyInstance.value) {
            return ContentCommand_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        if (value instanceof ContentCommand_Unlock) {
            return { "Unlock": ContentCommand_Unlock_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof ContentCommand_RedeemGrant) {
            return { "RedeemGrant": ContentCommand_RedeemGrant_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof ContentCommand_Logout) {
            return { "Logout": ContentCommand_Logout_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof ContentCommand_GetManifest) {
            return { "GetManifest": ContentCommand_GetManifest_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        throw new Error("Unhandled ADT branch: " + value.constructor?.name);
    }
    decode(ctx, json) {
        if (this !== ContentCommand_JsonCodec.lazyInstance.value) {
            return ContentCommand_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Unlock": return ContentCommand_Unlock_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "RedeemGrant": return ContentCommand_RedeemGrant_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "Logout": return ContentCommand_Logout_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "GetManifest": return ContentCommand_GetManifest_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ContentCommand_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ContentCommand_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ContentCommand';
    baboonTypeIdentifier() {
        return ContentCommand_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand';
    baboonAdtTypeIdentifier() {
        return ContentCommand_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ContentCommand_JsonCodec());
    static get instance() {
        return ContentCommand_JsonCodec.lazyInstance.value;
    }
}
