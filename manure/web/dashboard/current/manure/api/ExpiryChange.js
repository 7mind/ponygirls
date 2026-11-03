import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
export const ExpiryChange = {
    BaboonDomainVersion: '1.0.0',
    BaboonDomainIdentifier: 'manure.api',
    BaboonTypeIdentifier: 'manure.api/:#ExpiryChange',
    BaboonSameInVersions: ["1.0.0"],
    BaboonForwardReadable: { "1.0.0": "identical" },
    BaboonMinReaderVersions: { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" },
    BaboonAdtTypeIdentifier: 'manure.api/:#ExpiryChange',
    jsonCodec() {
        return ExpiryChange_JsonCodec.instance;
    }
};
export class ExpiryChange_Keep {
    $type = 'manure.api/[manure.api/:#ExpiryChange]#Keep';
    constructor() {
    }
    toJSON() {
        return {};
    }
    with(overrides) {
        return new ExpiryChange_Keep();
    }
    static fromPlain(obj) {
        return new ExpiryChange_Keep();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ExpiryChange_Keep.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ExpiryChange_Keep.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ExpiryChange]#Keep';
    baboonTypeIdentifier() {
        return ExpiryChange_Keep.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return ExpiryChange_Keep.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return ExpiryChange_Keep.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return ExpiryChange_Keep.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ExpiryChange';
    baboonAdtTypeIdentifier() {
        return ExpiryChange_Keep.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return ExpiryChange_Keep_JsonCodec.instance;
    }
}
export class ExpiryChange_Keep_JsonCodec {
    encode(ctx, value) {
        if (this !== ExpiryChange_Keep_JsonCodec.lazyInstance.value) {
            return ExpiryChange_Keep_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {};
    }
    decode(ctx, json) {
        if (this !== ExpiryChange_Keep_JsonCodec.lazyInstance.value) {
            return ExpiryChange_Keep_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new ExpiryChange_Keep();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ExpiryChange_Keep_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ExpiryChange_Keep_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ExpiryChange]#Keep';
    baboonTypeIdentifier() {
        return ExpiryChange_Keep_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ExpiryChange';
    baboonAdtTypeIdentifier() {
        return ExpiryChange_Keep_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ExpiryChange_Keep_JsonCodec());
    static get instance() {
        return ExpiryChange_Keep_JsonCodec.lazyInstance.value;
    }
}
export class ExpiryChange_Clear {
    $type = 'manure.api/[manure.api/:#ExpiryChange]#Clear';
    constructor() {
    }
    toJSON() {
        return {};
    }
    with(overrides) {
        return new ExpiryChange_Clear();
    }
    static fromPlain(obj) {
        return new ExpiryChange_Clear();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ExpiryChange_Clear.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ExpiryChange_Clear.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ExpiryChange]#Clear';
    baboonTypeIdentifier() {
        return ExpiryChange_Clear.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return ExpiryChange_Clear.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return ExpiryChange_Clear.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return ExpiryChange_Clear.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ExpiryChange';
    baboonAdtTypeIdentifier() {
        return ExpiryChange_Clear.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return ExpiryChange_Clear_JsonCodec.instance;
    }
}
export class ExpiryChange_Clear_JsonCodec {
    encode(ctx, value) {
        if (this !== ExpiryChange_Clear_JsonCodec.lazyInstance.value) {
            return ExpiryChange_Clear_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {};
    }
    decode(ctx, json) {
        if (this !== ExpiryChange_Clear_JsonCodec.lazyInstance.value) {
            return ExpiryChange_Clear_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new ExpiryChange_Clear();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ExpiryChange_Clear_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ExpiryChange_Clear_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ExpiryChange]#Clear';
    baboonTypeIdentifier() {
        return ExpiryChange_Clear_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ExpiryChange';
    baboonAdtTypeIdentifier() {
        return ExpiryChange_Clear_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ExpiryChange_Clear_JsonCodec());
    static get instance() {
        return ExpiryChange_Clear_JsonCodec.lazyInstance.value;
    }
}
export class ExpiryChange_Set {
    $type = 'manure.api/[manure.api/:#ExpiryChange]#Set';
    _seconds;
    constructor(seconds) {
        this._seconds = seconds;
    }
    get seconds() {
        return this._seconds;
    }
    toJSON() {
        return {
            seconds: this._seconds
        };
    }
    with(overrides) {
        return new ExpiryChange_Set('seconds' in overrides ? overrides.seconds : this._seconds);
    }
    static fromPlain(obj) {
        return new ExpiryChange_Set(obj.seconds);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ExpiryChange_Set.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ExpiryChange_Set.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ExpiryChange]#Set';
    baboonTypeIdentifier() {
        return ExpiryChange_Set.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return ExpiryChange_Set.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return ExpiryChange_Set.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return ExpiryChange_Set.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ExpiryChange';
    baboonAdtTypeIdentifier() {
        return ExpiryChange_Set.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return ExpiryChange_Set_JsonCodec.instance;
    }
}
export class ExpiryChange_Set_JsonCodec {
    encode(ctx, value) {
        if (this !== ExpiryChange_Set_JsonCodec.lazyInstance.value) {
            return ExpiryChange_Set_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "seconds": value.seconds,
        };
    }
    decode(ctx, json) {
        if (this !== ExpiryChange_Set_JsonCodec.lazyInstance.value) {
            return ExpiryChange_Set_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new ExpiryChange_Set(obj["seconds"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ExpiryChange_Set_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ExpiryChange_Set_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#ExpiryChange]#Set';
    baboonTypeIdentifier() {
        return ExpiryChange_Set_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ExpiryChange';
    baboonAdtTypeIdentifier() {
        return ExpiryChange_Set_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ExpiryChange_Set_JsonCodec());
    static get instance() {
        return ExpiryChange_Set_JsonCodec.lazyInstance.value;
    }
}
export class ExpiryChange_JsonCodec {
    encode(ctx, value) {
        if (this !== ExpiryChange_JsonCodec.lazyInstance.value) {
            return ExpiryChange_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        if (value instanceof ExpiryChange_Keep) {
            return { "Keep": ExpiryChange_Keep_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof ExpiryChange_Clear) {
            return { "Clear": ExpiryChange_Clear_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof ExpiryChange_Set) {
            return { "Set": ExpiryChange_Set_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        throw new Error("Unhandled ADT branch: " + value.constructor?.name);
    }
    decode(ctx, json) {
        if (this !== ExpiryChange_JsonCodec.lazyInstance.value) {
            return ExpiryChange_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Keep": return ExpiryChange_Keep_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "Clear": return ExpiryChange_Clear_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "Set": return ExpiryChange_Set_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ExpiryChange_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ExpiryChange_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ExpiryChange';
    baboonTypeIdentifier() {
        return ExpiryChange_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#ExpiryChange';
    baboonAdtTypeIdentifier() {
        return ExpiryChange_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ExpiryChange_JsonCodec());
    static get instance() {
        return ExpiryChange_JsonCodec.lazyInstance.value;
    }
}
