import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { ArtifactKind_JsonCodec } from './ArtifactKind.js';
import { ArtifactPatch_JsonCodec } from './ArtifactPatch.js';
import { CatalogueQuery_JsonCodec } from './CatalogueQuery.js';
import { ManifestEntry_JsonCodec } from './ManifestEntry.js';
import { SearchQuery_JsonCodec } from './SearchQuery.js';
import { Visibility_JsonCodec } from './Visibility.js';
export const Command = {
    BaboonDomainVersion: '1.0.0',
    BaboonDomainIdentifier: 'manure.api',
    BaboonTypeIdentifier: 'manure.api/:#Command',
    BaboonSameInVersions: ["1.0.0"],
    BaboonForwardReadable: { "1.0.0": "identical" },
    BaboonMinReaderVersions: { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" },
    BaboonAdtTypeIdentifier: 'manure.api/:#Command',
    jsonCodec() {
        return Command_JsonCodec.instance;
    }
};
export class Command_Version {
    $type = 'manure.api/[manure.api/:#Command]#Version';
    constructor() {
    }
    toJSON() {
        return {};
    }
    with(overrides) {
        return new Command_Version();
    }
    static fromPlain(obj) {
        return new Command_Version();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_Version.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_Version.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Version';
    baboonTypeIdentifier() {
        return Command_Version.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_Version.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_Version.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_Version.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_Version.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_Version_JsonCodec.instance;
    }
}
export class Command_Version_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_Version_JsonCodec.lazyInstance.value) {
            return Command_Version_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {};
    }
    decode(ctx, json) {
        if (this !== Command_Version_JsonCodec.lazyInstance.value) {
            return Command_Version_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_Version();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_Version_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_Version_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Version';
    baboonTypeIdentifier() {
        return Command_Version_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_Version_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_Version_JsonCodec());
    static get instance() {
        return Command_Version_JsonCodec.lazyInstance.value;
    }
}
export class Command_GetCapabilities {
    $type = 'manure.api/[manure.api/:#Command]#GetCapabilities';
    constructor() {
    }
    toJSON() {
        return {};
    }
    with(overrides) {
        return new Command_GetCapabilities();
    }
    static fromPlain(obj) {
        return new Command_GetCapabilities();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_GetCapabilities.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_GetCapabilities.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetCapabilities';
    baboonTypeIdentifier() {
        return Command_GetCapabilities.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_GetCapabilities.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_GetCapabilities.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_GetCapabilities.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_GetCapabilities.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_GetCapabilities_JsonCodec.instance;
    }
}
export class Command_GetCapabilities_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_GetCapabilities_JsonCodec.lazyInstance.value) {
            return Command_GetCapabilities_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {};
    }
    decode(ctx, json) {
        if (this !== Command_GetCapabilities_JsonCodec.lazyInstance.value) {
            return Command_GetCapabilities_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_GetCapabilities();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_GetCapabilities_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_GetCapabilities_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetCapabilities';
    baboonTypeIdentifier() {
        return Command_GetCapabilities_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_GetCapabilities_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_GetCapabilities_JsonCodec());
    static get instance() {
        return Command_GetCapabilities_JsonCodec.lazyInstance.value;
    }
}
export class Command_Login {
    $type = 'manure.api/[manure.api/:#Command]#Login';
    _token;
    constructor(token) {
        this._token = token;
    }
    get token() {
        return this._token;
    }
    toJSON() {
        return {
            token: this._token
        };
    }
    with(overrides) {
        return new Command_Login('token' in overrides ? overrides.token : this._token);
    }
    static fromPlain(obj) {
        return new Command_Login(obj.token);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_Login.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_Login.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Login';
    baboonTypeIdentifier() {
        return Command_Login.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_Login.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_Login.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_Login.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_Login.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_Login_JsonCodec.instance;
    }
}
export class Command_Login_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_Login_JsonCodec.lazyInstance.value) {
            return Command_Login_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "token": value.token,
        };
    }
    decode(ctx, json) {
        if (this !== Command_Login_JsonCodec.lazyInstance.value) {
            return Command_Login_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_Login(obj["token"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_Login_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_Login_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Login';
    baboonTypeIdentifier() {
        return Command_Login_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_Login_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_Login_JsonCodec());
    static get instance() {
        return Command_Login_JsonCodec.lazyInstance.value;
    }
}
export class Command_Logout {
    $type = 'manure.api/[manure.api/:#Command]#Logout';
    constructor() {
    }
    toJSON() {
        return {};
    }
    with(overrides) {
        return new Command_Logout();
    }
    static fromPlain(obj) {
        return new Command_Logout();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_Logout.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_Logout.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Logout';
    baboonTypeIdentifier() {
        return Command_Logout.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_Logout.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_Logout.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_Logout.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_Logout.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_Logout_JsonCodec.instance;
    }
}
export class Command_Logout_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_Logout_JsonCodec.lazyInstance.value) {
            return Command_Logout_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {};
    }
    decode(ctx, json) {
        if (this !== Command_Logout_JsonCodec.lazyInstance.value) {
            return Command_Logout_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_Logout();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_Logout_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_Logout_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Logout';
    baboonTypeIdentifier() {
        return Command_Logout_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_Logout_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_Logout_JsonCodec());
    static get instance() {
        return Command_Logout_JsonCodec.lazyInstance.value;
    }
}
export class Command_Whoami {
    $type = 'manure.api/[manure.api/:#Command]#Whoami';
    constructor() {
    }
    toJSON() {
        return {};
    }
    with(overrides) {
        return new Command_Whoami();
    }
    static fromPlain(obj) {
        return new Command_Whoami();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_Whoami.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_Whoami.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Whoami';
    baboonTypeIdentifier() {
        return Command_Whoami.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_Whoami.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_Whoami.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_Whoami.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_Whoami.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_Whoami_JsonCodec.instance;
    }
}
export class Command_Whoami_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_Whoami_JsonCodec.lazyInstance.value) {
            return Command_Whoami_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {};
    }
    decode(ctx, json) {
        if (this !== Command_Whoami_JsonCodec.lazyInstance.value) {
            return Command_Whoami_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_Whoami();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_Whoami_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_Whoami_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Whoami';
    baboonTypeIdentifier() {
        return Command_Whoami_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_Whoami_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_Whoami_JsonCodec());
    static get instance() {
        return Command_Whoami_JsonCodec.lazyInstance.value;
    }
}
export class Command_ListArtifacts {
    $type = 'manure.api/[manure.api/:#Command]#ListArtifacts';
    _query;
    constructor(query) {
        this._query = query;
    }
    get query() {
        return this._query;
    }
    toJSON() {
        return {
            query: this._query
        };
    }
    with(overrides) {
        return new Command_ListArtifacts('query' in overrides ? overrides.query : this._query);
    }
    static fromPlain(obj) {
        return new Command_ListArtifacts(obj.query);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_ListArtifacts.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_ListArtifacts.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#ListArtifacts';
    baboonTypeIdentifier() {
        return Command_ListArtifacts.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_ListArtifacts.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_ListArtifacts.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_ListArtifacts.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_ListArtifacts.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_ListArtifacts_JsonCodec.instance;
    }
}
export class Command_ListArtifacts_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_ListArtifacts_JsonCodec.lazyInstance.value) {
            return Command_ListArtifacts_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "query": CatalogueQuery_JsonCodec.instance.encode(BaboonCodecContext.Default, value.query),
        };
    }
    decode(ctx, json) {
        if (this !== Command_ListArtifacts_JsonCodec.lazyInstance.value) {
            return Command_ListArtifacts_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_ListArtifacts(CatalogueQuery_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["query"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_ListArtifacts_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_ListArtifacts_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#ListArtifacts';
    baboonTypeIdentifier() {
        return Command_ListArtifacts_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_ListArtifacts_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_ListArtifacts_JsonCodec());
    static get instance() {
        return Command_ListArtifacts_JsonCodec.lazyInstance.value;
    }
}
export class Command_InitUpload {
    $type = 'manure.api/[manure.api/:#Command]#InitUpload';
    _name;
    _kind;
    _visibility;
    _expiresInSeconds;
    _files;
    constructor(name, kind, visibility, expiresInSeconds, files) {
        this._name = name;
        this._kind = kind;
        this._visibility = visibility;
        this._expiresInSeconds = expiresInSeconds;
        this._files = files;
    }
    get name() {
        return this._name;
    }
    get kind() {
        return this._kind;
    }
    get visibility() {
        return this._visibility;
    }
    get expiresInSeconds() {
        return this._expiresInSeconds;
    }
    get files() {
        return this._files;
    }
    toJSON() {
        return {
            name: this._name,
            kind: this._kind,
            visibility: this._visibility,
            expiresInSeconds: this._expiresInSeconds !== undefined ? this._expiresInSeconds : undefined,
            files: this._files
        };
    }
    with(overrides) {
        return new Command_InitUpload('name' in overrides ? overrides.name : this._name, 'kind' in overrides ? overrides.kind : this._kind, 'visibility' in overrides ? overrides.visibility : this._visibility, 'expiresInSeconds' in overrides ? overrides.expiresInSeconds : this._expiresInSeconds, 'files' in overrides ? overrides.files : this._files);
    }
    static fromPlain(obj) {
        return new Command_InitUpload(obj.name, obj.kind, obj.visibility, obj.expiresInSeconds, obj.files);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_InitUpload.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_InitUpload.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#InitUpload';
    baboonTypeIdentifier() {
        return Command_InitUpload.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_InitUpload.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_InitUpload.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_InitUpload.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_InitUpload.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_InitUpload_JsonCodec.instance;
    }
}
export class Command_InitUpload_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_InitUpload_JsonCodec.lazyInstance.value) {
            return Command_InitUpload_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "name": value.name,
            "kind": ArtifactKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
            "visibility": Visibility_JsonCodec.instance.encode(BaboonCodecContext.Default, value.visibility),
            "expiresInSeconds": value.expiresInSeconds === undefined ? null : value.expiresInSeconds,
            "files": Array.from(value.files).map(item => ManifestEntry_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        };
    }
    decode(ctx, json) {
        if (this !== Command_InitUpload_JsonCodec.lazyInstance.value) {
            return Command_InitUpload_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_InitUpload(obj["name"], ArtifactKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]), Visibility_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["visibility"]), obj["expiresInSeconds"] === undefined || obj["expiresInSeconds"] === null ? undefined : obj["expiresInSeconds"] === undefined || obj["expiresInSeconds"] === null ? undefined : obj["expiresInSeconds"], obj["files"].map(item => ManifestEntry_JsonCodec.instance.decode(BaboonCodecContext.Default, item)));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_InitUpload_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_InitUpload_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#InitUpload';
    baboonTypeIdentifier() {
        return Command_InitUpload_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_InitUpload_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_InitUpload_JsonCodec());
    static get instance() {
        return Command_InitUpload_JsonCodec.lazyInstance.value;
    }
}
export class Command_GetArtifact {
    $type = 'manure.api/[manure.api/:#Command]#GetArtifact';
    _artifactId;
    constructor(artifactId) {
        this._artifactId = artifactId;
    }
    get artifactId() {
        return this._artifactId;
    }
    toJSON() {
        return {
            artifactId: this._artifactId
        };
    }
    with(overrides) {
        return new Command_GetArtifact('artifactId' in overrides ? overrides.artifactId : this._artifactId);
    }
    static fromPlain(obj) {
        return new Command_GetArtifact(obj.artifactId);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_GetArtifact.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_GetArtifact.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetArtifact';
    baboonTypeIdentifier() {
        return Command_GetArtifact.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_GetArtifact.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_GetArtifact.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_GetArtifact.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_GetArtifact.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_GetArtifact_JsonCodec.instance;
    }
}
export class Command_GetArtifact_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_GetArtifact_JsonCodec.lazyInstance.value) {
            return Command_GetArtifact_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifactId": value.artifactId,
        };
    }
    decode(ctx, json) {
        if (this !== Command_GetArtifact_JsonCodec.lazyInstance.value) {
            return Command_GetArtifact_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_GetArtifact(obj["artifactId"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_GetArtifact_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_GetArtifact_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetArtifact';
    baboonTypeIdentifier() {
        return Command_GetArtifact_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_GetArtifact_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_GetArtifact_JsonCodec());
    static get instance() {
        return Command_GetArtifact_JsonCodec.lazyInstance.value;
    }
}
export class Command_PatchArtifact {
    $type = 'manure.api/[manure.api/:#Command]#PatchArtifact';
    _artifactId;
    _patch;
    constructor(artifactId, patch) {
        this._artifactId = artifactId;
        this._patch = patch;
    }
    get artifactId() {
        return this._artifactId;
    }
    get patch() {
        return this._patch;
    }
    toJSON() {
        return {
            artifactId: this._artifactId,
            patch: this._patch
        };
    }
    with(overrides) {
        return new Command_PatchArtifact('artifactId' in overrides ? overrides.artifactId : this._artifactId, 'patch' in overrides ? overrides.patch : this._patch);
    }
    static fromPlain(obj) {
        return new Command_PatchArtifact(obj.artifactId, obj.patch);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_PatchArtifact.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_PatchArtifact.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#PatchArtifact';
    baboonTypeIdentifier() {
        return Command_PatchArtifact.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_PatchArtifact.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_PatchArtifact.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_PatchArtifact.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_PatchArtifact.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_PatchArtifact_JsonCodec.instance;
    }
}
export class Command_PatchArtifact_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_PatchArtifact_JsonCodec.lazyInstance.value) {
            return Command_PatchArtifact_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifactId": value.artifactId,
            "patch": ArtifactPatch_JsonCodec.instance.encode(BaboonCodecContext.Default, value.patch),
        };
    }
    decode(ctx, json) {
        if (this !== Command_PatchArtifact_JsonCodec.lazyInstance.value) {
            return Command_PatchArtifact_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_PatchArtifact(obj["artifactId"], ArtifactPatch_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["patch"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_PatchArtifact_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_PatchArtifact_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#PatchArtifact';
    baboonTypeIdentifier() {
        return Command_PatchArtifact_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_PatchArtifact_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_PatchArtifact_JsonCodec());
    static get instance() {
        return Command_PatchArtifact_JsonCodec.lazyInstance.value;
    }
}
export class Command_DeleteArtifact {
    $type = 'manure.api/[manure.api/:#Command]#DeleteArtifact';
    _artifactId;
    constructor(artifactId) {
        this._artifactId = artifactId;
    }
    get artifactId() {
        return this._artifactId;
    }
    toJSON() {
        return {
            artifactId: this._artifactId
        };
    }
    with(overrides) {
        return new Command_DeleteArtifact('artifactId' in overrides ? overrides.artifactId : this._artifactId);
    }
    static fromPlain(obj) {
        return new Command_DeleteArtifact(obj.artifactId);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_DeleteArtifact.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_DeleteArtifact.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#DeleteArtifact';
    baboonTypeIdentifier() {
        return Command_DeleteArtifact.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_DeleteArtifact.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_DeleteArtifact.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_DeleteArtifact.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_DeleteArtifact.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_DeleteArtifact_JsonCodec.instance;
    }
}
export class Command_DeleteArtifact_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_DeleteArtifact_JsonCodec.lazyInstance.value) {
            return Command_DeleteArtifact_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifactId": value.artifactId,
        };
    }
    decode(ctx, json) {
        if (this !== Command_DeleteArtifact_JsonCodec.lazyInstance.value) {
            return Command_DeleteArtifact_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_DeleteArtifact(obj["artifactId"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_DeleteArtifact_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_DeleteArtifact_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#DeleteArtifact';
    baboonTypeIdentifier() {
        return Command_DeleteArtifact_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_DeleteArtifact_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_DeleteArtifact_JsonCodec());
    static get instance() {
        return Command_DeleteArtifact_JsonCodec.lazyInstance.value;
    }
}
export class Command_RotateExternalPassword {
    $type = 'manure.api/[manure.api/:#Command]#RotateExternalPassword';
    _artifactId;
    constructor(artifactId) {
        this._artifactId = artifactId;
    }
    get artifactId() {
        return this._artifactId;
    }
    toJSON() {
        return {
            artifactId: this._artifactId
        };
    }
    with(overrides) {
        return new Command_RotateExternalPassword('artifactId' in overrides ? overrides.artifactId : this._artifactId);
    }
    static fromPlain(obj) {
        return new Command_RotateExternalPassword(obj.artifactId);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_RotateExternalPassword.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_RotateExternalPassword.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#RotateExternalPassword';
    baboonTypeIdentifier() {
        return Command_RotateExternalPassword.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_RotateExternalPassword.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_RotateExternalPassword.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_RotateExternalPassword.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_RotateExternalPassword.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_RotateExternalPassword_JsonCodec.instance;
    }
}
export class Command_RotateExternalPassword_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_RotateExternalPassword_JsonCodec.lazyInstance.value) {
            return Command_RotateExternalPassword_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifactId": value.artifactId,
        };
    }
    decode(ctx, json) {
        if (this !== Command_RotateExternalPassword_JsonCodec.lazyInstance.value) {
            return Command_RotateExternalPassword_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_RotateExternalPassword(obj["artifactId"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_RotateExternalPassword_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_RotateExternalPassword_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#RotateExternalPassword';
    baboonTypeIdentifier() {
        return Command_RotateExternalPassword_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_RotateExternalPassword_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_RotateExternalPassword_JsonCodec());
    static get instance() {
        return Command_RotateExternalPassword_JsonCodec.lazyInstance.value;
    }
}
export class Command_GetManifest {
    $type = 'manure.api/[manure.api/:#Command]#GetManifest';
    _artifactId;
    constructor(artifactId) {
        this._artifactId = artifactId;
    }
    get artifactId() {
        return this._artifactId;
    }
    toJSON() {
        return {
            artifactId: this._artifactId
        };
    }
    with(overrides) {
        return new Command_GetManifest('artifactId' in overrides ? overrides.artifactId : this._artifactId);
    }
    static fromPlain(obj) {
        return new Command_GetManifest(obj.artifactId);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_GetManifest.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_GetManifest.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetManifest';
    baboonTypeIdentifier() {
        return Command_GetManifest.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_GetManifest.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_GetManifest.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_GetManifest.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_GetManifest.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_GetManifest_JsonCodec.instance;
    }
}
export class Command_GetManifest_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_GetManifest_JsonCodec.lazyInstance.value) {
            return Command_GetManifest_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifactId": value.artifactId,
        };
    }
    decode(ctx, json) {
        if (this !== Command_GetManifest_JsonCodec.lazyInstance.value) {
            return Command_GetManifest_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_GetManifest(obj["artifactId"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_GetManifest_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_GetManifest_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetManifest';
    baboonTypeIdentifier() {
        return Command_GetManifest_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_GetManifest_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_GetManifest_JsonCodec());
    static get instance() {
        return Command_GetManifest_JsonCodec.lazyInstance.value;
    }
}
export class Command_GetUploadStatus {
    $type = 'manure.api/[manure.api/:#Command]#GetUploadStatus';
    _artifactId;
    constructor(artifactId) {
        this._artifactId = artifactId;
    }
    get artifactId() {
        return this._artifactId;
    }
    toJSON() {
        return {
            artifactId: this._artifactId
        };
    }
    with(overrides) {
        return new Command_GetUploadStatus('artifactId' in overrides ? overrides.artifactId : this._artifactId);
    }
    static fromPlain(obj) {
        return new Command_GetUploadStatus(obj.artifactId);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_GetUploadStatus.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_GetUploadStatus.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetUploadStatus';
    baboonTypeIdentifier() {
        return Command_GetUploadStatus.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_GetUploadStatus.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_GetUploadStatus.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_GetUploadStatus.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_GetUploadStatus.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_GetUploadStatus_JsonCodec.instance;
    }
}
export class Command_GetUploadStatus_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_GetUploadStatus_JsonCodec.lazyInstance.value) {
            return Command_GetUploadStatus_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifactId": value.artifactId,
        };
    }
    decode(ctx, json) {
        if (this !== Command_GetUploadStatus_JsonCodec.lazyInstance.value) {
            return Command_GetUploadStatus_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_GetUploadStatus(obj["artifactId"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_GetUploadStatus_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_GetUploadStatus_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetUploadStatus';
    baboonTypeIdentifier() {
        return Command_GetUploadStatus_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_GetUploadStatus_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_GetUploadStatus_JsonCodec());
    static get instance() {
        return Command_GetUploadStatus_JsonCodec.lazyInstance.value;
    }
}
export class Command_FinishUpload {
    $type = 'manure.api/[manure.api/:#Command]#FinishUpload';
    _artifactId;
    constructor(artifactId) {
        this._artifactId = artifactId;
    }
    get artifactId() {
        return this._artifactId;
    }
    toJSON() {
        return {
            artifactId: this._artifactId
        };
    }
    with(overrides) {
        return new Command_FinishUpload('artifactId' in overrides ? overrides.artifactId : this._artifactId);
    }
    static fromPlain(obj) {
        return new Command_FinishUpload(obj.artifactId);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_FinishUpload.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_FinishUpload.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#FinishUpload';
    baboonTypeIdentifier() {
        return Command_FinishUpload.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_FinishUpload.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_FinishUpload.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_FinishUpload.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_FinishUpload.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_FinishUpload_JsonCodec.instance;
    }
}
export class Command_FinishUpload_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_FinishUpload_JsonCodec.lazyInstance.value) {
            return Command_FinishUpload_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifactId": value.artifactId,
        };
    }
    decode(ctx, json) {
        if (this !== Command_FinishUpload_JsonCodec.lazyInstance.value) {
            return Command_FinishUpload_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_FinishUpload(obj["artifactId"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_FinishUpload_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_FinishUpload_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#FinishUpload';
    baboonTypeIdentifier() {
        return Command_FinishUpload_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_FinishUpload_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_FinishUpload_JsonCodec());
    static get instance() {
        return Command_FinishUpload_JsonCodec.lazyInstance.value;
    }
}
export class Command_CreateGrant {
    $type = 'manure.api/[manure.api/:#Command]#CreateGrant';
    _artifactId;
    constructor(artifactId) {
        this._artifactId = artifactId;
    }
    get artifactId() {
        return this._artifactId;
    }
    toJSON() {
        return {
            artifactId: this._artifactId
        };
    }
    with(overrides) {
        return new Command_CreateGrant('artifactId' in overrides ? overrides.artifactId : this._artifactId);
    }
    static fromPlain(obj) {
        return new Command_CreateGrant(obj.artifactId);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_CreateGrant.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_CreateGrant.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#CreateGrant';
    baboonTypeIdentifier() {
        return Command_CreateGrant.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_CreateGrant.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_CreateGrant.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_CreateGrant.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_CreateGrant.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_CreateGrant_JsonCodec.instance;
    }
}
export class Command_CreateGrant_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_CreateGrant_JsonCodec.lazyInstance.value) {
            return Command_CreateGrant_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifactId": value.artifactId,
        };
    }
    decode(ctx, json) {
        if (this !== Command_CreateGrant_JsonCodec.lazyInstance.value) {
            return Command_CreateGrant_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_CreateGrant(obj["artifactId"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_CreateGrant_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_CreateGrant_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#CreateGrant';
    baboonTypeIdentifier() {
        return Command_CreateGrant_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_CreateGrant_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_CreateGrant_JsonCodec());
    static get instance() {
        return Command_CreateGrant_JsonCodec.lazyInstance.value;
    }
}
export class Command_Search {
    $type = 'manure.api/[manure.api/:#Command]#Search';
    _query;
    constructor(query) {
        this._query = query;
    }
    get query() {
        return this._query;
    }
    toJSON() {
        return {
            query: this._query
        };
    }
    with(overrides) {
        return new Command_Search('query' in overrides ? overrides.query : this._query);
    }
    static fromPlain(obj) {
        return new Command_Search(obj.query);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_Search.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_Search.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Search';
    baboonTypeIdentifier() {
        return Command_Search.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Command_Search.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Command_Search.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Command_Search.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_Search.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Command_Search_JsonCodec.instance;
    }
}
export class Command_Search_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_Search_JsonCodec.lazyInstance.value) {
            return Command_Search_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "query": SearchQuery_JsonCodec.instance.encode(BaboonCodecContext.Default, value.query),
        };
    }
    decode(ctx, json) {
        if (this !== Command_Search_JsonCodec.lazyInstance.value) {
            return Command_Search_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Command_Search(SearchQuery_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["query"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_Search_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_Search_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Search';
    baboonTypeIdentifier() {
        return Command_Search_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_Search_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_Search_JsonCodec());
    static get instance() {
        return Command_Search_JsonCodec.lazyInstance.value;
    }
}
export class Command_JsonCodec {
    encode(ctx, value) {
        if (this !== Command_JsonCodec.lazyInstance.value) {
            return Command_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        if (value instanceof Command_Version) {
            return { "Version": Command_Version_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Command_GetCapabilities) {
            return { "GetCapabilities": Command_GetCapabilities_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Command_Login) {
            return { "Login": Command_Login_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Command_Logout) {
            return { "Logout": Command_Logout_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Command_Whoami) {
            return { "Whoami": Command_Whoami_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Command_ListArtifacts) {
            return { "ListArtifacts": Command_ListArtifacts_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Command_InitUpload) {
            return { "InitUpload": Command_InitUpload_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Command_GetArtifact) {
            return { "GetArtifact": Command_GetArtifact_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Command_PatchArtifact) {
            return { "PatchArtifact": Command_PatchArtifact_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Command_DeleteArtifact) {
            return { "DeleteArtifact": Command_DeleteArtifact_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Command_RotateExternalPassword) {
            return { "RotateExternalPassword": Command_RotateExternalPassword_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Command_GetManifest) {
            return { "GetManifest": Command_GetManifest_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Command_GetUploadStatus) {
            return { "GetUploadStatus": Command_GetUploadStatus_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Command_FinishUpload) {
            return { "FinishUpload": Command_FinishUpload_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Command_CreateGrant) {
            return { "CreateGrant": Command_CreateGrant_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Command_Search) {
            return { "Search": Command_Search_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        throw new Error("Unhandled ADT branch: " + value.constructor?.name);
    }
    decode(ctx, json) {
        if (this !== Command_JsonCodec.lazyInstance.value) {
            return Command_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Version": return Command_Version_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "GetCapabilities": return Command_GetCapabilities_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "Login": return Command_Login_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "Logout": return Command_Logout_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "Whoami": return Command_Whoami_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "ListArtifacts": return Command_ListArtifacts_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "InitUpload": return Command_InitUpload_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "GetArtifact": return Command_GetArtifact_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "PatchArtifact": return Command_PatchArtifact_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "DeleteArtifact": return Command_DeleteArtifact_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "RotateExternalPassword": return Command_RotateExternalPassword_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "GetManifest": return Command_GetManifest_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "GetUploadStatus": return Command_GetUploadStatus_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "FinishUpload": return Command_FinishUpload_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "CreateGrant": return Command_CreateGrant_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "Search": return Command_Search_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Command_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Command_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#Command';
    baboonTypeIdentifier() {
        return Command_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Command';
    baboonAdtTypeIdentifier() {
        return Command_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Command_JsonCodec());
    static get instance() {
        return Command_JsonCodec.lazyInstance.value;
    }
}
