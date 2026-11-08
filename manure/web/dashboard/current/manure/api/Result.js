import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { Artifact_JsonCodec } from './Artifact.js';
import { ArtifactState_JsonCodec } from './ArtifactState.js';
import { Capabilities_JsonCodec } from './Capabilities.js';
import { CataloguePage_JsonCodec } from './CataloguePage.js';
import { Failure_JsonCodec } from './Failure.js';
import { Manifest_JsonCodec } from './Manifest.js';
import { Principal_JsonCodec } from './Principal.js';
import { SearchPage_JsonCodec } from './SearchPage.js';
import { UploadStatus_JsonCodec } from './UploadStatus.js';
import { VersionInfo_JsonCodec } from './VersionInfo.js';
export const Result = {
    BaboonDomainVersion: '1.0.0',
    BaboonDomainIdentifier: 'manure.api',
    BaboonTypeIdentifier: 'manure.api/:#Result',
    BaboonSameInVersions: ["1.0.0"],
    BaboonForwardReadable: { "1.0.0": "identical" },
    BaboonMinReaderVersions: { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" },
    BaboonAdtTypeIdentifier: 'manure.api/:#Result',
    jsonCodec() {
        return Result_JsonCodec.instance;
    }
};
export class Result_Version {
    $type = 'manure.api/[manure.api/:#Result]#Version';
    _versions;
    constructor(versions) {
        this._versions = versions;
    }
    get versions() {
        return this._versions;
    }
    toJSON() {
        return {
            versions: this._versions
        };
    }
    with(overrides) {
        return new Result_Version('versions' in overrides ? overrides.versions : this._versions);
    }
    static fromPlain(obj) {
        return new Result_Version(obj.versions);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_Version.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_Version.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Version';
    baboonTypeIdentifier() {
        return Result_Version.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_Version.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_Version.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_Version.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_Version.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_Version_JsonCodec.instance;
    }
}
export class Result_Version_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_Version_JsonCodec.lazyInstance.value) {
            return Result_Version_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "versions": VersionInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.versions),
        };
    }
    decode(ctx, json) {
        if (this !== Result_Version_JsonCodec.lazyInstance.value) {
            return Result_Version_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_Version(VersionInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["versions"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_Version_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_Version_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Version';
    baboonTypeIdentifier() {
        return Result_Version_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_Version_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_Version_JsonCodec());
    static get instance() {
        return Result_Version_JsonCodec.lazyInstance.value;
    }
}
export class Result_CapabilityInfo {
    $type = 'manure.api/[manure.api/:#Result]#CapabilityInfo';
    _capabilities;
    constructor(capabilities) {
        this._capabilities = capabilities;
    }
    get capabilities() {
        return this._capabilities;
    }
    toJSON() {
        return {
            capabilities: this._capabilities
        };
    }
    with(overrides) {
        return new Result_CapabilityInfo('capabilities' in overrides ? overrides.capabilities : this._capabilities);
    }
    static fromPlain(obj) {
        return new Result_CapabilityInfo(obj.capabilities);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_CapabilityInfo.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_CapabilityInfo.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#CapabilityInfo';
    baboonTypeIdentifier() {
        return Result_CapabilityInfo.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_CapabilityInfo.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_CapabilityInfo.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_CapabilityInfo.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_CapabilityInfo.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_CapabilityInfo_JsonCodec.instance;
    }
}
export class Result_CapabilityInfo_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_CapabilityInfo_JsonCodec.lazyInstance.value) {
            return Result_CapabilityInfo_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "capabilities": Capabilities_JsonCodec.instance.encode(BaboonCodecContext.Default, value.capabilities),
        };
    }
    decode(ctx, json) {
        if (this !== Result_CapabilityInfo_JsonCodec.lazyInstance.value) {
            return Result_CapabilityInfo_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_CapabilityInfo(Capabilities_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["capabilities"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_CapabilityInfo_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_CapabilityInfo_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#CapabilityInfo';
    baboonTypeIdentifier() {
        return Result_CapabilityInfo_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_CapabilityInfo_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_CapabilityInfo_JsonCodec());
    static get instance() {
        return Result_CapabilityInfo_JsonCodec.lazyInstance.value;
    }
}
export class Result_Identity {
    $type = 'manure.api/[manure.api/:#Result]#Identity';
    _principal;
    constructor(principal) {
        this._principal = principal;
    }
    get principal() {
        return this._principal;
    }
    toJSON() {
        return {
            principal: this._principal
        };
    }
    with(overrides) {
        return new Result_Identity('principal' in overrides ? overrides.principal : this._principal);
    }
    static fromPlain(obj) {
        return new Result_Identity(obj.principal);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_Identity.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_Identity.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Identity';
    baboonTypeIdentifier() {
        return Result_Identity.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_Identity.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_Identity.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_Identity.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_Identity.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_Identity_JsonCodec.instance;
    }
}
export class Result_Identity_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_Identity_JsonCodec.lazyInstance.value) {
            return Result_Identity_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "principal": Principal_JsonCodec.instance.encode(BaboonCodecContext.Default, value.principal),
        };
    }
    decode(ctx, json) {
        if (this !== Result_Identity_JsonCodec.lazyInstance.value) {
            return Result_Identity_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_Identity(Principal_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["principal"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_Identity_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_Identity_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Identity';
    baboonTypeIdentifier() {
        return Result_Identity_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_Identity_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_Identity_JsonCodec());
    static get instance() {
        return Result_Identity_JsonCodec.lazyInstance.value;
    }
}
export class Result_Ok {
    $type = 'manure.api/[manure.api/:#Result]#Ok';
    constructor() {
    }
    toJSON() {
        return {};
    }
    with(overrides) {
        return new Result_Ok();
    }
    static fromPlain(obj) {
        return new Result_Ok();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_Ok.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_Ok.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Ok';
    baboonTypeIdentifier() {
        return Result_Ok.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_Ok.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_Ok.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_Ok.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_Ok.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_Ok_JsonCodec.instance;
    }
}
export class Result_Ok_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_Ok_JsonCodec.lazyInstance.value) {
            return Result_Ok_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {};
    }
    decode(ctx, json) {
        if (this !== Result_Ok_JsonCodec.lazyInstance.value) {
            return Result_Ok_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_Ok();
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_Ok_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_Ok_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Ok';
    baboonTypeIdentifier() {
        return Result_Ok_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_Ok_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_Ok_JsonCodec());
    static get instance() {
        return Result_Ok_JsonCodec.lazyInstance.value;
    }
}
export class Result_Catalogue {
    $type = 'manure.api/[manure.api/:#Result]#Catalogue';
    _page;
    constructor(page) {
        this._page = page;
    }
    get page() {
        return this._page;
    }
    toJSON() {
        return {
            page: this._page
        };
    }
    with(overrides) {
        return new Result_Catalogue('page' in overrides ? overrides.page : this._page);
    }
    static fromPlain(obj) {
        return new Result_Catalogue(obj.page);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_Catalogue.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_Catalogue.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Catalogue';
    baboonTypeIdentifier() {
        return Result_Catalogue.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_Catalogue.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_Catalogue.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_Catalogue.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_Catalogue.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_Catalogue_JsonCodec.instance;
    }
}
export class Result_Catalogue_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_Catalogue_JsonCodec.lazyInstance.value) {
            return Result_Catalogue_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "page": CataloguePage_JsonCodec.instance.encode(BaboonCodecContext.Default, value.page),
        };
    }
    decode(ctx, json) {
        if (this !== Result_Catalogue_JsonCodec.lazyInstance.value) {
            return Result_Catalogue_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_Catalogue(CataloguePage_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["page"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_Catalogue_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_Catalogue_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Catalogue';
    baboonTypeIdentifier() {
        return Result_Catalogue_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_Catalogue_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_Catalogue_JsonCodec());
    static get instance() {
        return Result_Catalogue_JsonCodec.lazyInstance.value;
    }
}
export class Result_UploadInitialized {
    $type = 'manure.api/[manure.api/:#Result]#UploadInitialized';
    _artifactId;
    _chunkBytes;
    _contentUrl;
    _externalPassword;
    constructor(artifactId, chunkBytes, contentUrl, externalPassword) {
        this._artifactId = artifactId;
        this._chunkBytes = chunkBytes;
        this._contentUrl = contentUrl;
        this._externalPassword = externalPassword;
    }
    get artifactId() {
        return this._artifactId;
    }
    get chunkBytes() {
        return this._chunkBytes;
    }
    get contentUrl() {
        return this._contentUrl;
    }
    get externalPassword() {
        return this._externalPassword;
    }
    toJSON() {
        return {
            artifactId: this._artifactId,
            chunkBytes: this._chunkBytes,
            contentUrl: this._contentUrl,
            externalPassword: this._externalPassword !== undefined ? this._externalPassword : undefined
        };
    }
    with(overrides) {
        return new Result_UploadInitialized('artifactId' in overrides ? overrides.artifactId : this._artifactId, 'chunkBytes' in overrides ? overrides.chunkBytes : this._chunkBytes, 'contentUrl' in overrides ? overrides.contentUrl : this._contentUrl, 'externalPassword' in overrides ? overrides.externalPassword : this._externalPassword);
    }
    static fromPlain(obj) {
        return new Result_UploadInitialized(obj.artifactId, obj.chunkBytes, obj.contentUrl, obj.externalPassword);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_UploadInitialized.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_UploadInitialized.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#UploadInitialized';
    baboonTypeIdentifier() {
        return Result_UploadInitialized.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_UploadInitialized.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_UploadInitialized.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_UploadInitialized.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_UploadInitialized.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_UploadInitialized_JsonCodec.instance;
    }
}
export class Result_UploadInitialized_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_UploadInitialized_JsonCodec.lazyInstance.value) {
            return Result_UploadInitialized_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifactId": value.artifactId,
            "chunkBytes": value.chunkBytes,
            "contentUrl": value.contentUrl,
            "externalPassword": value.externalPassword === undefined ? null : value.externalPassword,
        };
    }
    decode(ctx, json) {
        if (this !== Result_UploadInitialized_JsonCodec.lazyInstance.value) {
            return Result_UploadInitialized_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_UploadInitialized(obj["artifactId"], obj["chunkBytes"], obj["contentUrl"], obj["externalPassword"] === undefined || obj["externalPassword"] === null ? undefined : obj["externalPassword"] === undefined || obj["externalPassword"] === null ? undefined : obj["externalPassword"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_UploadInitialized_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_UploadInitialized_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#UploadInitialized';
    baboonTypeIdentifier() {
        return Result_UploadInitialized_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_UploadInitialized_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_UploadInitialized_JsonCodec());
    static get instance() {
        return Result_UploadInitialized_JsonCodec.lazyInstance.value;
    }
}
export class Result_ArtifactInfo {
    $type = 'manure.api/[manure.api/:#Result]#ArtifactInfo';
    _artifact;
    constructor(artifact) {
        this._artifact = artifact;
    }
    get artifact() {
        return this._artifact;
    }
    toJSON() {
        return {
            artifact: this._artifact
        };
    }
    with(overrides) {
        return new Result_ArtifactInfo('artifact' in overrides ? overrides.artifact : this._artifact);
    }
    static fromPlain(obj) {
        return new Result_ArtifactInfo(obj.artifact);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_ArtifactInfo.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_ArtifactInfo.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#ArtifactInfo';
    baboonTypeIdentifier() {
        return Result_ArtifactInfo.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_ArtifactInfo.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_ArtifactInfo.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_ArtifactInfo.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_ArtifactInfo.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_ArtifactInfo_JsonCodec.instance;
    }
}
export class Result_ArtifactInfo_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_ArtifactInfo_JsonCodec.lazyInstance.value) {
            return Result_ArtifactInfo_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifact": Artifact_JsonCodec.instance.encode(BaboonCodecContext.Default, value.artifact),
        };
    }
    decode(ctx, json) {
        if (this !== Result_ArtifactInfo_JsonCodec.lazyInstance.value) {
            return Result_ArtifactInfo_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_ArtifactInfo(Artifact_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["artifact"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_ArtifactInfo_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_ArtifactInfo_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#ArtifactInfo';
    baboonTypeIdentifier() {
        return Result_ArtifactInfo_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_ArtifactInfo_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_ArtifactInfo_JsonCodec());
    static get instance() {
        return Result_ArtifactInfo_JsonCodec.lazyInstance.value;
    }
}
export class Result_ArtifactPatched {
    $type = 'manure.api/[manure.api/:#Result]#ArtifactPatched';
    _artifact;
    _externalPassword;
    constructor(artifact, externalPassword) {
        this._artifact = artifact;
        this._externalPassword = externalPassword;
    }
    get artifact() {
        return this._artifact;
    }
    get externalPassword() {
        return this._externalPassword;
    }
    toJSON() {
        return {
            artifact: this._artifact,
            externalPassword: this._externalPassword !== undefined ? this._externalPassword : undefined
        };
    }
    with(overrides) {
        return new Result_ArtifactPatched('artifact' in overrides ? overrides.artifact : this._artifact, 'externalPassword' in overrides ? overrides.externalPassword : this._externalPassword);
    }
    static fromPlain(obj) {
        return new Result_ArtifactPatched(obj.artifact, obj.externalPassword);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_ArtifactPatched.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_ArtifactPatched.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#ArtifactPatched';
    baboonTypeIdentifier() {
        return Result_ArtifactPatched.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_ArtifactPatched.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_ArtifactPatched.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_ArtifactPatched.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_ArtifactPatched.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_ArtifactPatched_JsonCodec.instance;
    }
}
export class Result_ArtifactPatched_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_ArtifactPatched_JsonCodec.lazyInstance.value) {
            return Result_ArtifactPatched_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifact": Artifact_JsonCodec.instance.encode(BaboonCodecContext.Default, value.artifact),
            "externalPassword": value.externalPassword === undefined ? null : value.externalPassword,
        };
    }
    decode(ctx, json) {
        if (this !== Result_ArtifactPatched_JsonCodec.lazyInstance.value) {
            return Result_ArtifactPatched_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_ArtifactPatched(Artifact_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["artifact"]), obj["externalPassword"] === undefined || obj["externalPassword"] === null ? undefined : obj["externalPassword"] === undefined || obj["externalPassword"] === null ? undefined : obj["externalPassword"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_ArtifactPatched_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_ArtifactPatched_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#ArtifactPatched';
    baboonTypeIdentifier() {
        return Result_ArtifactPatched_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_ArtifactPatched_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_ArtifactPatched_JsonCodec());
    static get instance() {
        return Result_ArtifactPatched_JsonCodec.lazyInstance.value;
    }
}
export class Result_PasswordRotated {
    $type = 'manure.api/[manure.api/:#Result]#PasswordRotated';
    _externalPassword;
    constructor(externalPassword) {
        this._externalPassword = externalPassword;
    }
    get externalPassword() {
        return this._externalPassword;
    }
    toJSON() {
        return {
            externalPassword: this._externalPassword
        };
    }
    with(overrides) {
        return new Result_PasswordRotated('externalPassword' in overrides ? overrides.externalPassword : this._externalPassword);
    }
    static fromPlain(obj) {
        return new Result_PasswordRotated(obj.externalPassword);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_PasswordRotated.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_PasswordRotated.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#PasswordRotated';
    baboonTypeIdentifier() {
        return Result_PasswordRotated.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_PasswordRotated.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_PasswordRotated.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_PasswordRotated.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_PasswordRotated.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_PasswordRotated_JsonCodec.instance;
    }
}
export class Result_PasswordRotated_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_PasswordRotated_JsonCodec.lazyInstance.value) {
            return Result_PasswordRotated_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "externalPassword": value.externalPassword,
        };
    }
    decode(ctx, json) {
        if (this !== Result_PasswordRotated_JsonCodec.lazyInstance.value) {
            return Result_PasswordRotated_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_PasswordRotated(obj["externalPassword"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_PasswordRotated_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_PasswordRotated_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#PasswordRotated';
    baboonTypeIdentifier() {
        return Result_PasswordRotated_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_PasswordRotated_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_PasswordRotated_JsonCodec());
    static get instance() {
        return Result_PasswordRotated_JsonCodec.lazyInstance.value;
    }
}
export class Result_ExternalPasswordRetrieved {
    $type = 'manure.api/[manure.api/:#Result]#ExternalPasswordRetrieved';
    _externalPassword;
    constructor(externalPassword) {
        this._externalPassword = externalPassword;
    }
    get externalPassword() {
        return this._externalPassword;
    }
    toJSON() {
        return {
            externalPassword: this._externalPassword !== undefined ? this._externalPassword : undefined
        };
    }
    with(overrides) {
        return new Result_ExternalPasswordRetrieved('externalPassword' in overrides ? overrides.externalPassword : this._externalPassword);
    }
    static fromPlain(obj) {
        return new Result_ExternalPasswordRetrieved(obj.externalPassword);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_ExternalPasswordRetrieved.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_ExternalPasswordRetrieved.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#ExternalPasswordRetrieved';
    baboonTypeIdentifier() {
        return Result_ExternalPasswordRetrieved.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_ExternalPasswordRetrieved.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_ExternalPasswordRetrieved.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_ExternalPasswordRetrieved.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_ExternalPasswordRetrieved.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_ExternalPasswordRetrieved_JsonCodec.instance;
    }
}
export class Result_ExternalPasswordRetrieved_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_ExternalPasswordRetrieved_JsonCodec.lazyInstance.value) {
            return Result_ExternalPasswordRetrieved_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "externalPassword": value.externalPassword === undefined ? null : value.externalPassword,
        };
    }
    decode(ctx, json) {
        if (this !== Result_ExternalPasswordRetrieved_JsonCodec.lazyInstance.value) {
            return Result_ExternalPasswordRetrieved_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_ExternalPasswordRetrieved(obj["externalPassword"] === undefined || obj["externalPassword"] === null ? undefined : obj["externalPassword"] === undefined || obj["externalPassword"] === null ? undefined : obj["externalPassword"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_ExternalPasswordRetrieved_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_ExternalPasswordRetrieved_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#ExternalPasswordRetrieved';
    baboonTypeIdentifier() {
        return Result_ExternalPasswordRetrieved_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_ExternalPasswordRetrieved_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_ExternalPasswordRetrieved_JsonCodec());
    static get instance() {
        return Result_ExternalPasswordRetrieved_JsonCodec.lazyInstance.value;
    }
}
export class Result_ArtifactManifest {
    $type = 'manure.api/[manure.api/:#Result]#ArtifactManifest';
    _manifest;
    constructor(manifest) {
        this._manifest = manifest;
    }
    get manifest() {
        return this._manifest;
    }
    toJSON() {
        return {
            manifest: this._manifest
        };
    }
    with(overrides) {
        return new Result_ArtifactManifest('manifest' in overrides ? overrides.manifest : this._manifest);
    }
    static fromPlain(obj) {
        return new Result_ArtifactManifest(obj.manifest);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_ArtifactManifest.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_ArtifactManifest.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#ArtifactManifest';
    baboonTypeIdentifier() {
        return Result_ArtifactManifest.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_ArtifactManifest.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_ArtifactManifest.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_ArtifactManifest.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_ArtifactManifest.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_ArtifactManifest_JsonCodec.instance;
    }
}
export class Result_ArtifactManifest_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_ArtifactManifest_JsonCodec.lazyInstance.value) {
            return Result_ArtifactManifest_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "manifest": Manifest_JsonCodec.instance.encode(BaboonCodecContext.Default, value.manifest),
        };
    }
    decode(ctx, json) {
        if (this !== Result_ArtifactManifest_JsonCodec.lazyInstance.value) {
            return Result_ArtifactManifest_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_ArtifactManifest(Manifest_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["manifest"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_ArtifactManifest_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_ArtifactManifest_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#ArtifactManifest';
    baboonTypeIdentifier() {
        return Result_ArtifactManifest_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_ArtifactManifest_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_ArtifactManifest_JsonCodec());
    static get instance() {
        return Result_ArtifactManifest_JsonCodec.lazyInstance.value;
    }
}
export class Result_UploadProgress {
    $type = 'manure.api/[manure.api/:#Result]#UploadProgress';
    _status;
    constructor(status) {
        this._status = status;
    }
    get status() {
        return this._status;
    }
    toJSON() {
        return {
            status: this._status
        };
    }
    with(overrides) {
        return new Result_UploadProgress('status' in overrides ? overrides.status : this._status);
    }
    static fromPlain(obj) {
        return new Result_UploadProgress(obj.status);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_UploadProgress.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_UploadProgress.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#UploadProgress';
    baboonTypeIdentifier() {
        return Result_UploadProgress.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_UploadProgress.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_UploadProgress.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_UploadProgress.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_UploadProgress.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_UploadProgress_JsonCodec.instance;
    }
}
export class Result_UploadProgress_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_UploadProgress_JsonCodec.lazyInstance.value) {
            return Result_UploadProgress_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "status": UploadStatus_JsonCodec.instance.encode(BaboonCodecContext.Default, value.status),
        };
    }
    decode(ctx, json) {
        if (this !== Result_UploadProgress_JsonCodec.lazyInstance.value) {
            return Result_UploadProgress_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_UploadProgress(UploadStatus_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["status"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_UploadProgress_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_UploadProgress_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#UploadProgress';
    baboonTypeIdentifier() {
        return Result_UploadProgress_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_UploadProgress_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_UploadProgress_JsonCodec());
    static get instance() {
        return Result_UploadProgress_JsonCodec.lazyInstance.value;
    }
}
export class Result_UploadFinished {
    $type = 'manure.api/[manure.api/:#Result]#UploadFinished';
    _artifactId;
    _state;
    _contentUrl;
    constructor(artifactId, state, contentUrl) {
        this._artifactId = artifactId;
        this._state = state;
        this._contentUrl = contentUrl;
    }
    get artifactId() {
        return this._artifactId;
    }
    get state() {
        return this._state;
    }
    get contentUrl() {
        return this._contentUrl;
    }
    toJSON() {
        return {
            artifactId: this._artifactId,
            state: this._state,
            contentUrl: this._contentUrl
        };
    }
    with(overrides) {
        return new Result_UploadFinished('artifactId' in overrides ? overrides.artifactId : this._artifactId, 'state' in overrides ? overrides.state : this._state, 'contentUrl' in overrides ? overrides.contentUrl : this._contentUrl);
    }
    static fromPlain(obj) {
        return new Result_UploadFinished(obj.artifactId, obj.state, obj.contentUrl);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_UploadFinished.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_UploadFinished.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#UploadFinished';
    baboonTypeIdentifier() {
        return Result_UploadFinished.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_UploadFinished.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_UploadFinished.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_UploadFinished.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_UploadFinished.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_UploadFinished_JsonCodec.instance;
    }
}
export class Result_UploadFinished_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_UploadFinished_JsonCodec.lazyInstance.value) {
            return Result_UploadFinished_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifactId": value.artifactId,
            "state": ArtifactState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.state),
            "contentUrl": value.contentUrl,
        };
    }
    decode(ctx, json) {
        if (this !== Result_UploadFinished_JsonCodec.lazyInstance.value) {
            return Result_UploadFinished_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_UploadFinished(obj["artifactId"], ArtifactState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]), obj["contentUrl"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_UploadFinished_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_UploadFinished_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#UploadFinished';
    baboonTypeIdentifier() {
        return Result_UploadFinished_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_UploadFinished_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_UploadFinished_JsonCodec());
    static get instance() {
        return Result_UploadFinished_JsonCodec.lazyInstance.value;
    }
}
export class Result_GrantCreated {
    $type = 'manure.api/[manure.api/:#Result]#GrantCreated';
    _grant;
    _expiresInSeconds;
    constructor(grant, expiresInSeconds) {
        this._grant = grant;
        this._expiresInSeconds = expiresInSeconds;
    }
    get grant() {
        return this._grant;
    }
    get expiresInSeconds() {
        return this._expiresInSeconds;
    }
    toJSON() {
        return {
            grant: this._grant,
            expiresInSeconds: this._expiresInSeconds
        };
    }
    with(overrides) {
        return new Result_GrantCreated('grant' in overrides ? overrides.grant : this._grant, 'expiresInSeconds' in overrides ? overrides.expiresInSeconds : this._expiresInSeconds);
    }
    static fromPlain(obj) {
        return new Result_GrantCreated(obj.grant, obj.expiresInSeconds);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_GrantCreated.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_GrantCreated.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#GrantCreated';
    baboonTypeIdentifier() {
        return Result_GrantCreated.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_GrantCreated.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_GrantCreated.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_GrantCreated.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_GrantCreated.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_GrantCreated_JsonCodec.instance;
    }
}
export class Result_GrantCreated_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_GrantCreated_JsonCodec.lazyInstance.value) {
            return Result_GrantCreated_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "grant": value.grant,
            "expiresInSeconds": value.expiresInSeconds,
        };
    }
    decode(ctx, json) {
        if (this !== Result_GrantCreated_JsonCodec.lazyInstance.value) {
            return Result_GrantCreated_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_GrantCreated(obj["grant"], obj["expiresInSeconds"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_GrantCreated_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_GrantCreated_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#GrantCreated';
    baboonTypeIdentifier() {
        return Result_GrantCreated_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_GrantCreated_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_GrantCreated_JsonCodec());
    static get instance() {
        return Result_GrantCreated_JsonCodec.lazyInstance.value;
    }
}
export class Result_SearchResults {
    $type = 'manure.api/[manure.api/:#Result]#SearchResults';
    _page;
    constructor(page) {
        this._page = page;
    }
    get page() {
        return this._page;
    }
    toJSON() {
        return {
            page: this._page
        };
    }
    with(overrides) {
        return new Result_SearchResults('page' in overrides ? overrides.page : this._page);
    }
    static fromPlain(obj) {
        return new Result_SearchResults(obj.page);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_SearchResults.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_SearchResults.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#SearchResults';
    baboonTypeIdentifier() {
        return Result_SearchResults.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_SearchResults.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_SearchResults.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_SearchResults.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_SearchResults.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_SearchResults_JsonCodec.instance;
    }
}
export class Result_SearchResults_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_SearchResults_JsonCodec.lazyInstance.value) {
            return Result_SearchResults_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "page": SearchPage_JsonCodec.instance.encode(BaboonCodecContext.Default, value.page),
        };
    }
    decode(ctx, json) {
        if (this !== Result_SearchResults_JsonCodec.lazyInstance.value) {
            return Result_SearchResults_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_SearchResults(SearchPage_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["page"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_SearchResults_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_SearchResults_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#SearchResults';
    baboonTypeIdentifier() {
        return Result_SearchResults_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_SearchResults_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_SearchResults_JsonCodec());
    static get instance() {
        return Result_SearchResults_JsonCodec.lazyInstance.value;
    }
}
export class Result_Error {
    $type = 'manure.api/[manure.api/:#Result]#Error';
    _failure;
    constructor(failure) {
        this._failure = failure;
    }
    get failure() {
        return this._failure;
    }
    toJSON() {
        return {
            failure: this._failure
        };
    }
    with(overrides) {
        return new Result_Error('failure' in overrides ? overrides.failure : this._failure);
    }
    static fromPlain(obj) {
        return new Result_Error(obj.failure);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_Error.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_Error.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Error';
    baboonTypeIdentifier() {
        return Result_Error.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return Result_Error.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return Result_Error.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return Result_Error.BaboonMinReaderVersions;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_Error.BaboonAdtTypeIdentifier;
    }
    static jsonCodec() {
        return Result_Error_JsonCodec.instance;
    }
}
export class Result_Error_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_Error_JsonCodec.lazyInstance.value) {
            return Result_Error_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "failure": Failure_JsonCodec.instance.encode(BaboonCodecContext.Default, value.failure),
        };
    }
    decode(ctx, json) {
        if (this !== Result_Error_JsonCodec.lazyInstance.value) {
            return Result_Error_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new Result_Error(Failure_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["failure"]));
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_Error_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_Error_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Error';
    baboonTypeIdentifier() {
        return Result_Error_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_Error_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_Error_JsonCodec());
    static get instance() {
        return Result_Error_JsonCodec.lazyInstance.value;
    }
}
export class Result_JsonCodec {
    encode(ctx, value) {
        if (this !== Result_JsonCodec.lazyInstance.value) {
            return Result_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        if (value instanceof Result_Version) {
            return { "Version": Result_Version_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Result_CapabilityInfo) {
            return { "CapabilityInfo": Result_CapabilityInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Result_Identity) {
            return { "Identity": Result_Identity_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Result_Ok) {
            return { "Ok": Result_Ok_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Result_Catalogue) {
            return { "Catalogue": Result_Catalogue_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Result_UploadInitialized) {
            return { "UploadInitialized": Result_UploadInitialized_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Result_ArtifactInfo) {
            return { "ArtifactInfo": Result_ArtifactInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Result_ArtifactPatched) {
            return { "ArtifactPatched": Result_ArtifactPatched_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Result_PasswordRotated) {
            return { "PasswordRotated": Result_PasswordRotated_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Result_ExternalPasswordRetrieved) {
            return { "ExternalPasswordRetrieved": Result_ExternalPasswordRetrieved_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Result_ArtifactManifest) {
            return { "ArtifactManifest": Result_ArtifactManifest_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Result_UploadProgress) {
            return { "UploadProgress": Result_UploadProgress_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Result_UploadFinished) {
            return { "UploadFinished": Result_UploadFinished_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Result_GrantCreated) {
            return { "GrantCreated": Result_GrantCreated_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Result_SearchResults) {
            return { "SearchResults": Result_SearchResults_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        if (value instanceof Result_Error) {
            return { "Error": Result_Error_JsonCodec.instance.encode(BaboonCodecContext.Default, value) };
        }
        throw new Error("Unhandled ADT branch: " + value.constructor?.name);
    }
    decode(ctx, json) {
        if (this !== Result_JsonCodec.lazyInstance.value) {
            return Result_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Version": return Result_Version_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "CapabilityInfo": return Result_CapabilityInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "Identity": return Result_Identity_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "Ok": return Result_Ok_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "Catalogue": return Result_Catalogue_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "UploadInitialized": return Result_UploadInitialized_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "ArtifactInfo": return Result_ArtifactInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "ArtifactPatched": return Result_ArtifactPatched_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "PasswordRotated": return Result_PasswordRotated_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "ExternalPasswordRetrieved": return Result_ExternalPasswordRetrieved_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "ArtifactManifest": return Result_ArtifactManifest_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "UploadProgress": return Result_UploadProgress_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "UploadFinished": return Result_UploadFinished_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "GrantCreated": return Result_GrantCreated_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "SearchResults": return Result_SearchResults_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            case "Error": return Result_Error_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key]);
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return Result_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return Result_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#Result';
    baboonTypeIdentifier() {
        return Result_JsonCodec.BaboonTypeIdentifier;
    }
    static BaboonAdtTypeIdentifier = 'manure.api/:#Result';
    baboonAdtTypeIdentifier() {
        return Result_JsonCodec.BaboonAdtTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new Result_JsonCodec());
    static get instance() {
        return Result_JsonCodec.lazyInstance.value;
    }
}
