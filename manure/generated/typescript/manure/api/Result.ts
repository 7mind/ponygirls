import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Artifact, Artifact_JsonCodec} from './Artifact.js'
import {ArtifactState, ArtifactState_JsonCodec} from './ArtifactState.js'
import {Capabilities, Capabilities_JsonCodec} from './Capabilities.js'
import {CataloguePage, CataloguePage_JsonCodec} from './CataloguePage.js'
import {Failure, Failure_JsonCodec} from './Failure.js'
import {Manifest, Manifest_JsonCodec} from './Manifest.js'
import {Principal, Principal_JsonCodec} from './Principal.js'
import {SearchPage, SearchPage_JsonCodec} from './SearchPage.js'
import {UploadStatus, UploadStatus_JsonCodec} from './UploadStatus.js'
import {VersionInfo, VersionInfo_JsonCodec} from './VersionInfo.js'

export type Result = Result_Version | Result_CapabilityInfo | Result_Identity | Result_Ok | Result_Catalogue | Result_UploadInitialized | Result_ArtifactInfo | Result_ArtifactPatched | Result_PasswordRotated | Result_ArtifactManifest | Result_UploadProgress | Result_UploadFinished | Result_GrantCreated | Result_SearchResults | Result_Error

export const Result = {
    BaboonDomainVersion: '1.0.0',
    BaboonDomainIdentifier: 'manure.api',
    BaboonTypeIdentifier: 'manure.api/:#Result',
    BaboonSameInVersions: ["1.0.0"],
    BaboonForwardReadable: { "1.0.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'manure.api/:#Result',
    jsonCodec(): Result_JsonCodec {
        return Result_JsonCodec.instance
    }
} as const

export class Result_Version implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Result]#Version' as const;
    private readonly _versions: VersionInfo;

    constructor(versions: VersionInfo) {
        this._versions = versions
    }

    public get versions(): VersionInfo {
        return this._versions;
    }

    public toJSON(): Record<string, unknown> {
        return {
            versions: this._versions
        };
    }

    public with(overrides: {versions?: VersionInfo}): Result_Version {
        return new Result_Version(
            'versions' in overrides ? overrides.versions! : this._versions
        );
    }

    public static fromPlain(obj: {versions: VersionInfo}): Result_Version {
        return new Result_Version(
            obj.versions
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_Version.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_Version.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Version'
    public baboonTypeIdentifier() {
        return Result_Version.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Result_Version.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Result_Version.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Version.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Version.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Version_JsonCodec {
        return Result_Version_JsonCodec.instance
    }
}

export class Result_Version_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Version): unknown {
        if (this !== Result_Version_JsonCodec.lazyInstance.value) {
          return Result_Version_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "versions": VersionInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.versions),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Version {
        if (this !== Result_Version_JsonCodec .lazyInstance.value) {
            return Result_Version_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Version (
            VersionInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["versions"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_Version_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_Version_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Version'
    public baboonTypeIdentifier() {
        return Result_Version_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Version_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Version_JsonCodec())
    public static get instance(): Result_Version_JsonCodec {
        return Result_Version_JsonCodec.lazyInstance.value
    }
}

export class Result_CapabilityInfo implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Result]#CapabilityInfo' as const;
    private readonly _capabilities: Capabilities;

    constructor(capabilities: Capabilities) {
        this._capabilities = capabilities
    }

    public get capabilities(): Capabilities {
        return this._capabilities;
    }

    public toJSON(): Record<string, unknown> {
        return {
            capabilities: this._capabilities
        };
    }

    public with(overrides: {capabilities?: Capabilities}): Result_CapabilityInfo {
        return new Result_CapabilityInfo(
            'capabilities' in overrides ? overrides.capabilities! : this._capabilities
        );
    }

    public static fromPlain(obj: {capabilities: Capabilities}): Result_CapabilityInfo {
        return new Result_CapabilityInfo(
            obj.capabilities
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_CapabilityInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_CapabilityInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#CapabilityInfo'
    public baboonTypeIdentifier() {
        return Result_CapabilityInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Result_CapabilityInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Result_CapabilityInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_CapabilityInfo.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_CapabilityInfo.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_CapabilityInfo_JsonCodec {
        return Result_CapabilityInfo_JsonCodec.instance
    }
}

export class Result_CapabilityInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_CapabilityInfo): unknown {
        if (this !== Result_CapabilityInfo_JsonCodec.lazyInstance.value) {
          return Result_CapabilityInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "capabilities": Capabilities_JsonCodec.instance.encode(BaboonCodecContext.Default, value.capabilities),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_CapabilityInfo {
        if (this !== Result_CapabilityInfo_JsonCodec .lazyInstance.value) {
            return Result_CapabilityInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_CapabilityInfo (
            Capabilities_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["capabilities"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_CapabilityInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_CapabilityInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#CapabilityInfo'
    public baboonTypeIdentifier() {
        return Result_CapabilityInfo_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_CapabilityInfo_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_CapabilityInfo_JsonCodec())
    public static get instance(): Result_CapabilityInfo_JsonCodec {
        return Result_CapabilityInfo_JsonCodec.lazyInstance.value
    }
}

export class Result_Identity implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Result]#Identity' as const;
    private readonly _principal: Principal;

    constructor(principal: Principal) {
        this._principal = principal
    }

    public get principal(): Principal {
        return this._principal;
    }

    public toJSON(): Record<string, unknown> {
        return {
            principal: this._principal
        };
    }

    public with(overrides: {principal?: Principal}): Result_Identity {
        return new Result_Identity(
            'principal' in overrides ? overrides.principal! : this._principal
        );
    }

    public static fromPlain(obj: {principal: Principal}): Result_Identity {
        return new Result_Identity(
            obj.principal
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_Identity.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_Identity.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Identity'
    public baboonTypeIdentifier() {
        return Result_Identity.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Result_Identity.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Result_Identity.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Identity.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Identity.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Identity_JsonCodec {
        return Result_Identity_JsonCodec.instance
    }
}

export class Result_Identity_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Identity): unknown {
        if (this !== Result_Identity_JsonCodec.lazyInstance.value) {
          return Result_Identity_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "principal": Principal_JsonCodec.instance.encode(BaboonCodecContext.Default, value.principal),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Identity {
        if (this !== Result_Identity_JsonCodec .lazyInstance.value) {
            return Result_Identity_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Identity (
            Principal_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["principal"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_Identity_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_Identity_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Identity'
    public baboonTypeIdentifier() {
        return Result_Identity_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Identity_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Identity_JsonCodec())
    public static get instance(): Result_Identity_JsonCodec {
        return Result_Identity_JsonCodec.lazyInstance.value
    }
}

export class Result_Ok implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Result]#Ok' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): Result_Ok {
        return new Result_Ok(
            
        );
    }

    public static fromPlain(obj: {}): Result_Ok {
        return new Result_Ok(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_Ok.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_Ok.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Ok'
    public baboonTypeIdentifier() {
        return Result_Ok.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Result_Ok.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Result_Ok.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Ok.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Ok.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Ok_JsonCodec {
        return Result_Ok_JsonCodec.instance
    }
}

export class Result_Ok_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Ok): unknown {
        if (this !== Result_Ok_JsonCodec.lazyInstance.value) {
          return Result_Ok_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Ok {
        if (this !== Result_Ok_JsonCodec .lazyInstance.value) {
            return Result_Ok_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Ok (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_Ok_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_Ok_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Ok'
    public baboonTypeIdentifier() {
        return Result_Ok_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Ok_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Ok_JsonCodec())
    public static get instance(): Result_Ok_JsonCodec {
        return Result_Ok_JsonCodec.lazyInstance.value
    }
}

export class Result_Catalogue implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Result]#Catalogue' as const;
    private readonly _page: CataloguePage;

    constructor(page: CataloguePage) {
        this._page = page
    }

    public get page(): CataloguePage {
        return this._page;
    }

    public toJSON(): Record<string, unknown> {
        return {
            page: this._page
        };
    }

    public with(overrides: {page?: CataloguePage}): Result_Catalogue {
        return new Result_Catalogue(
            'page' in overrides ? overrides.page! : this._page
        );
    }

    public static fromPlain(obj: {page: CataloguePage}): Result_Catalogue {
        return new Result_Catalogue(
            obj.page
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_Catalogue.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_Catalogue.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Catalogue'
    public baboonTypeIdentifier() {
        return Result_Catalogue.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Result_Catalogue.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Result_Catalogue.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Catalogue.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Catalogue.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Catalogue_JsonCodec {
        return Result_Catalogue_JsonCodec.instance
    }
}

export class Result_Catalogue_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Catalogue): unknown {
        if (this !== Result_Catalogue_JsonCodec.lazyInstance.value) {
          return Result_Catalogue_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "page": CataloguePage_JsonCodec.instance.encode(BaboonCodecContext.Default, value.page),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Catalogue {
        if (this !== Result_Catalogue_JsonCodec .lazyInstance.value) {
            return Result_Catalogue_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Catalogue (
            CataloguePage_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["page"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_Catalogue_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_Catalogue_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Catalogue'
    public baboonTypeIdentifier() {
        return Result_Catalogue_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Catalogue_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Catalogue_JsonCodec())
    public static get instance(): Result_Catalogue_JsonCodec {
        return Result_Catalogue_JsonCodec.lazyInstance.value
    }
}

export class Result_UploadInitialized implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Result]#UploadInitialized' as const;
    private readonly _artifactId: string;
    private readonly _chunkBytes: number;
    private readonly _contentUrl: string;
    private readonly _externalPassword: string | undefined;

    constructor(artifactId: string, chunkBytes: number, contentUrl: string, externalPassword: string | undefined) {
        this._artifactId = artifactId
        this._chunkBytes = chunkBytes
        this._contentUrl = contentUrl
        this._externalPassword = externalPassword
    }

    public get artifactId(): string {
        return this._artifactId;
    }
    public get chunkBytes(): number {
        return this._chunkBytes;
    }
    public get contentUrl(): string {
        return this._contentUrl;
    }
    public get externalPassword(): string | undefined {
        return this._externalPassword;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifactId: this._artifactId,
            chunkBytes: this._chunkBytes,
            contentUrl: this._contentUrl,
            externalPassword: this._externalPassword !== undefined ? this._externalPassword : undefined
        };
    }

    public with(overrides: {artifactId?: string; chunkBytes?: number; contentUrl?: string; externalPassword?: string | undefined}): Result_UploadInitialized {
        return new Result_UploadInitialized(
            'artifactId' in overrides ? overrides.artifactId! : this._artifactId,
            'chunkBytes' in overrides ? overrides.chunkBytes! : this._chunkBytes,
            'contentUrl' in overrides ? overrides.contentUrl! : this._contentUrl,
            'externalPassword' in overrides ? overrides.externalPassword! : this._externalPassword
        );
    }

    public static fromPlain(obj: {artifactId: string; chunkBytes: number; contentUrl: string; externalPassword: string | undefined}): Result_UploadInitialized {
        return new Result_UploadInitialized(
            obj.artifactId,
            obj.chunkBytes,
            obj.contentUrl,
            obj.externalPassword
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_UploadInitialized.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_UploadInitialized.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#UploadInitialized'
    public baboonTypeIdentifier() {
        return Result_UploadInitialized.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Result_UploadInitialized.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Result_UploadInitialized.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_UploadInitialized.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_UploadInitialized.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_UploadInitialized_JsonCodec {
        return Result_UploadInitialized_JsonCodec.instance
    }
}

export class Result_UploadInitialized_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_UploadInitialized): unknown {
        if (this !== Result_UploadInitialized_JsonCodec.lazyInstance.value) {
          return Result_UploadInitialized_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifactId": value.artifactId,
            "chunkBytes": value.chunkBytes,
            "contentUrl": value.contentUrl,
            "externalPassword": value.externalPassword === undefined ? null : value.externalPassword,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_UploadInitialized {
        if (this !== Result_UploadInitialized_JsonCodec .lazyInstance.value) {
            return Result_UploadInitialized_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_UploadInitialized (
            obj["artifactId"] as string,
            obj["chunkBytes"] as number,
            obj["contentUrl"] as string,
            obj["externalPassword"] === undefined || obj["externalPassword"] === null ? undefined : obj["externalPassword"] === undefined || obj["externalPassword"] === null ? undefined : obj["externalPassword"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_UploadInitialized_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_UploadInitialized_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#UploadInitialized'
    public baboonTypeIdentifier() {
        return Result_UploadInitialized_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_UploadInitialized_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_UploadInitialized_JsonCodec())
    public static get instance(): Result_UploadInitialized_JsonCodec {
        return Result_UploadInitialized_JsonCodec.lazyInstance.value
    }
}

export class Result_ArtifactInfo implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Result]#ArtifactInfo' as const;
    private readonly _artifact: Artifact;

    constructor(artifact: Artifact) {
        this._artifact = artifact
    }

    public get artifact(): Artifact {
        return this._artifact;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifact: this._artifact
        };
    }

    public with(overrides: {artifact?: Artifact}): Result_ArtifactInfo {
        return new Result_ArtifactInfo(
            'artifact' in overrides ? overrides.artifact! : this._artifact
        );
    }

    public static fromPlain(obj: {artifact: Artifact}): Result_ArtifactInfo {
        return new Result_ArtifactInfo(
            obj.artifact
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_ArtifactInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_ArtifactInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#ArtifactInfo'
    public baboonTypeIdentifier() {
        return Result_ArtifactInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Result_ArtifactInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Result_ArtifactInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_ArtifactInfo.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_ArtifactInfo.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_ArtifactInfo_JsonCodec {
        return Result_ArtifactInfo_JsonCodec.instance
    }
}

export class Result_ArtifactInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_ArtifactInfo): unknown {
        if (this !== Result_ArtifactInfo_JsonCodec.lazyInstance.value) {
          return Result_ArtifactInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifact": Artifact_JsonCodec.instance.encode(BaboonCodecContext.Default, value.artifact),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_ArtifactInfo {
        if (this !== Result_ArtifactInfo_JsonCodec .lazyInstance.value) {
            return Result_ArtifactInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_ArtifactInfo (
            Artifact_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["artifact"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_ArtifactInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_ArtifactInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#ArtifactInfo'
    public baboonTypeIdentifier() {
        return Result_ArtifactInfo_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_ArtifactInfo_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_ArtifactInfo_JsonCodec())
    public static get instance(): Result_ArtifactInfo_JsonCodec {
        return Result_ArtifactInfo_JsonCodec.lazyInstance.value
    }
}

export class Result_ArtifactPatched implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Result]#ArtifactPatched' as const;
    private readonly _artifact: Artifact;
    private readonly _externalPassword: string | undefined;

    constructor(artifact: Artifact, externalPassword: string | undefined) {
        this._artifact = artifact
        this._externalPassword = externalPassword
    }

    public get artifact(): Artifact {
        return this._artifact;
    }
    public get externalPassword(): string | undefined {
        return this._externalPassword;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifact: this._artifact,
            externalPassword: this._externalPassword !== undefined ? this._externalPassword : undefined
        };
    }

    public with(overrides: {artifact?: Artifact; externalPassword?: string | undefined}): Result_ArtifactPatched {
        return new Result_ArtifactPatched(
            'artifact' in overrides ? overrides.artifact! : this._artifact,
            'externalPassword' in overrides ? overrides.externalPassword! : this._externalPassword
        );
    }

    public static fromPlain(obj: {artifact: Artifact; externalPassword: string | undefined}): Result_ArtifactPatched {
        return new Result_ArtifactPatched(
            obj.artifact,
            obj.externalPassword
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_ArtifactPatched.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_ArtifactPatched.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#ArtifactPatched'
    public baboonTypeIdentifier() {
        return Result_ArtifactPatched.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Result_ArtifactPatched.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Result_ArtifactPatched.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_ArtifactPatched.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_ArtifactPatched.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_ArtifactPatched_JsonCodec {
        return Result_ArtifactPatched_JsonCodec.instance
    }
}

export class Result_ArtifactPatched_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_ArtifactPatched): unknown {
        if (this !== Result_ArtifactPatched_JsonCodec.lazyInstance.value) {
          return Result_ArtifactPatched_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifact": Artifact_JsonCodec.instance.encode(BaboonCodecContext.Default, value.artifact),
            "externalPassword": value.externalPassword === undefined ? null : value.externalPassword,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_ArtifactPatched {
        if (this !== Result_ArtifactPatched_JsonCodec .lazyInstance.value) {
            return Result_ArtifactPatched_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_ArtifactPatched (
            Artifact_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["artifact"]),
            obj["externalPassword"] === undefined || obj["externalPassword"] === null ? undefined : obj["externalPassword"] === undefined || obj["externalPassword"] === null ? undefined : obj["externalPassword"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_ArtifactPatched_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_ArtifactPatched_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#ArtifactPatched'
    public baboonTypeIdentifier() {
        return Result_ArtifactPatched_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_ArtifactPatched_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_ArtifactPatched_JsonCodec())
    public static get instance(): Result_ArtifactPatched_JsonCodec {
        return Result_ArtifactPatched_JsonCodec.lazyInstance.value
    }
}

export class Result_PasswordRotated implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Result]#PasswordRotated' as const;
    private readonly _externalPassword: string;

    constructor(externalPassword: string) {
        this._externalPassword = externalPassword
    }

    public get externalPassword(): string {
        return this._externalPassword;
    }

    public toJSON(): Record<string, unknown> {
        return {
            externalPassword: this._externalPassword
        };
    }

    public with(overrides: {externalPassword?: string}): Result_PasswordRotated {
        return new Result_PasswordRotated(
            'externalPassword' in overrides ? overrides.externalPassword! : this._externalPassword
        );
    }

    public static fromPlain(obj: {externalPassword: string}): Result_PasswordRotated {
        return new Result_PasswordRotated(
            obj.externalPassword
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_PasswordRotated.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_PasswordRotated.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#PasswordRotated'
    public baboonTypeIdentifier() {
        return Result_PasswordRotated.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Result_PasswordRotated.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Result_PasswordRotated.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_PasswordRotated.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_PasswordRotated.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_PasswordRotated_JsonCodec {
        return Result_PasswordRotated_JsonCodec.instance
    }
}

export class Result_PasswordRotated_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_PasswordRotated): unknown {
        if (this !== Result_PasswordRotated_JsonCodec.lazyInstance.value) {
          return Result_PasswordRotated_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "externalPassword": value.externalPassword,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_PasswordRotated {
        if (this !== Result_PasswordRotated_JsonCodec .lazyInstance.value) {
            return Result_PasswordRotated_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_PasswordRotated (
            obj["externalPassword"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_PasswordRotated_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_PasswordRotated_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#PasswordRotated'
    public baboonTypeIdentifier() {
        return Result_PasswordRotated_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_PasswordRotated_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_PasswordRotated_JsonCodec())
    public static get instance(): Result_PasswordRotated_JsonCodec {
        return Result_PasswordRotated_JsonCodec.lazyInstance.value
    }
}

export class Result_ArtifactManifest implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Result]#ArtifactManifest' as const;
    private readonly _manifest: Manifest;

    constructor(manifest: Manifest) {
        this._manifest = manifest
    }

    public get manifest(): Manifest {
        return this._manifest;
    }

    public toJSON(): Record<string, unknown> {
        return {
            manifest: this._manifest
        };
    }

    public with(overrides: {manifest?: Manifest}): Result_ArtifactManifest {
        return new Result_ArtifactManifest(
            'manifest' in overrides ? overrides.manifest! : this._manifest
        );
    }

    public static fromPlain(obj: {manifest: Manifest}): Result_ArtifactManifest {
        return new Result_ArtifactManifest(
            obj.manifest
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_ArtifactManifest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_ArtifactManifest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#ArtifactManifest'
    public baboonTypeIdentifier() {
        return Result_ArtifactManifest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Result_ArtifactManifest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Result_ArtifactManifest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_ArtifactManifest.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_ArtifactManifest.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_ArtifactManifest_JsonCodec {
        return Result_ArtifactManifest_JsonCodec.instance
    }
}

export class Result_ArtifactManifest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_ArtifactManifest): unknown {
        if (this !== Result_ArtifactManifest_JsonCodec.lazyInstance.value) {
          return Result_ArtifactManifest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "manifest": Manifest_JsonCodec.instance.encode(BaboonCodecContext.Default, value.manifest),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_ArtifactManifest {
        if (this !== Result_ArtifactManifest_JsonCodec .lazyInstance.value) {
            return Result_ArtifactManifest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_ArtifactManifest (
            Manifest_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["manifest"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_ArtifactManifest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_ArtifactManifest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#ArtifactManifest'
    public baboonTypeIdentifier() {
        return Result_ArtifactManifest_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_ArtifactManifest_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_ArtifactManifest_JsonCodec())
    public static get instance(): Result_ArtifactManifest_JsonCodec {
        return Result_ArtifactManifest_JsonCodec.lazyInstance.value
    }
}

export class Result_UploadProgress implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Result]#UploadProgress' as const;
    private readonly _status: UploadStatus;

    constructor(status: UploadStatus) {
        this._status = status
    }

    public get status(): UploadStatus {
        return this._status;
    }

    public toJSON(): Record<string, unknown> {
        return {
            status: this._status
        };
    }

    public with(overrides: {status?: UploadStatus}): Result_UploadProgress {
        return new Result_UploadProgress(
            'status' in overrides ? overrides.status! : this._status
        );
    }

    public static fromPlain(obj: {status: UploadStatus}): Result_UploadProgress {
        return new Result_UploadProgress(
            obj.status
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_UploadProgress.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_UploadProgress.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#UploadProgress'
    public baboonTypeIdentifier() {
        return Result_UploadProgress.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Result_UploadProgress.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Result_UploadProgress.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_UploadProgress.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_UploadProgress.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_UploadProgress_JsonCodec {
        return Result_UploadProgress_JsonCodec.instance
    }
}

export class Result_UploadProgress_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_UploadProgress): unknown {
        if (this !== Result_UploadProgress_JsonCodec.lazyInstance.value) {
          return Result_UploadProgress_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "status": UploadStatus_JsonCodec.instance.encode(BaboonCodecContext.Default, value.status),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_UploadProgress {
        if (this !== Result_UploadProgress_JsonCodec .lazyInstance.value) {
            return Result_UploadProgress_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_UploadProgress (
            UploadStatus_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["status"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_UploadProgress_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_UploadProgress_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#UploadProgress'
    public baboonTypeIdentifier() {
        return Result_UploadProgress_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_UploadProgress_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_UploadProgress_JsonCodec())
    public static get instance(): Result_UploadProgress_JsonCodec {
        return Result_UploadProgress_JsonCodec.lazyInstance.value
    }
}

export class Result_UploadFinished implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Result]#UploadFinished' as const;
    private readonly _artifactId: string;
    private readonly _state: ArtifactState;
    private readonly _contentUrl: string;

    constructor(artifactId: string, state: ArtifactState, contentUrl: string) {
        this._artifactId = artifactId
        this._state = state
        this._contentUrl = contentUrl
    }

    public get artifactId(): string {
        return this._artifactId;
    }
    public get state(): ArtifactState {
        return this._state;
    }
    public get contentUrl(): string {
        return this._contentUrl;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifactId: this._artifactId,
            state: this._state,
            contentUrl: this._contentUrl
        };
    }

    public with(overrides: {artifactId?: string; state?: ArtifactState; contentUrl?: string}): Result_UploadFinished {
        return new Result_UploadFinished(
            'artifactId' in overrides ? overrides.artifactId! : this._artifactId,
            'state' in overrides ? overrides.state! : this._state,
            'contentUrl' in overrides ? overrides.contentUrl! : this._contentUrl
        );
    }

    public static fromPlain(obj: {artifactId: string; state: ArtifactState; contentUrl: string}): Result_UploadFinished {
        return new Result_UploadFinished(
            obj.artifactId,
            obj.state,
            obj.contentUrl
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_UploadFinished.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_UploadFinished.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#UploadFinished'
    public baboonTypeIdentifier() {
        return Result_UploadFinished.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Result_UploadFinished.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Result_UploadFinished.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_UploadFinished.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_UploadFinished.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_UploadFinished_JsonCodec {
        return Result_UploadFinished_JsonCodec.instance
    }
}

export class Result_UploadFinished_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_UploadFinished): unknown {
        if (this !== Result_UploadFinished_JsonCodec.lazyInstance.value) {
          return Result_UploadFinished_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifactId": value.artifactId,
            "state": ArtifactState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.state),
            "contentUrl": value.contentUrl,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_UploadFinished {
        if (this !== Result_UploadFinished_JsonCodec .lazyInstance.value) {
            return Result_UploadFinished_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_UploadFinished (
            obj["artifactId"] as string,
            ArtifactState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]),
            obj["contentUrl"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_UploadFinished_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_UploadFinished_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#UploadFinished'
    public baboonTypeIdentifier() {
        return Result_UploadFinished_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_UploadFinished_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_UploadFinished_JsonCodec())
    public static get instance(): Result_UploadFinished_JsonCodec {
        return Result_UploadFinished_JsonCodec.lazyInstance.value
    }
}

export class Result_GrantCreated implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Result]#GrantCreated' as const;
    private readonly _grant: string;
    private readonly _expiresInSeconds: number;

    constructor(grant: string, expiresInSeconds: number) {
        this._grant = grant
        this._expiresInSeconds = expiresInSeconds
    }

    public get grant(): string {
        return this._grant;
    }
    public get expiresInSeconds(): number {
        return this._expiresInSeconds;
    }

    public toJSON(): Record<string, unknown> {
        return {
            grant: this._grant,
            expiresInSeconds: this._expiresInSeconds
        };
    }

    public with(overrides: {grant?: string; expiresInSeconds?: number}): Result_GrantCreated {
        return new Result_GrantCreated(
            'grant' in overrides ? overrides.grant! : this._grant,
            'expiresInSeconds' in overrides ? overrides.expiresInSeconds! : this._expiresInSeconds
        );
    }

    public static fromPlain(obj: {grant: string; expiresInSeconds: number}): Result_GrantCreated {
        return new Result_GrantCreated(
            obj.grant,
            obj.expiresInSeconds
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_GrantCreated.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_GrantCreated.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#GrantCreated'
    public baboonTypeIdentifier() {
        return Result_GrantCreated.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Result_GrantCreated.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Result_GrantCreated.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_GrantCreated.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_GrantCreated.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_GrantCreated_JsonCodec {
        return Result_GrantCreated_JsonCodec.instance
    }
}

export class Result_GrantCreated_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_GrantCreated): unknown {
        if (this !== Result_GrantCreated_JsonCodec.lazyInstance.value) {
          return Result_GrantCreated_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "grant": value.grant,
            "expiresInSeconds": value.expiresInSeconds,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_GrantCreated {
        if (this !== Result_GrantCreated_JsonCodec .lazyInstance.value) {
            return Result_GrantCreated_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_GrantCreated (
            obj["grant"] as string,
            obj["expiresInSeconds"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_GrantCreated_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_GrantCreated_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#GrantCreated'
    public baboonTypeIdentifier() {
        return Result_GrantCreated_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_GrantCreated_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_GrantCreated_JsonCodec())
    public static get instance(): Result_GrantCreated_JsonCodec {
        return Result_GrantCreated_JsonCodec.lazyInstance.value
    }
}

export class Result_SearchResults implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Result]#SearchResults' as const;
    private readonly _page: SearchPage;

    constructor(page: SearchPage) {
        this._page = page
    }

    public get page(): SearchPage {
        return this._page;
    }

    public toJSON(): Record<string, unknown> {
        return {
            page: this._page
        };
    }

    public with(overrides: {page?: SearchPage}): Result_SearchResults {
        return new Result_SearchResults(
            'page' in overrides ? overrides.page! : this._page
        );
    }

    public static fromPlain(obj: {page: SearchPage}): Result_SearchResults {
        return new Result_SearchResults(
            obj.page
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_SearchResults.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_SearchResults.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#SearchResults'
    public baboonTypeIdentifier() {
        return Result_SearchResults.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Result_SearchResults.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Result_SearchResults.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_SearchResults.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_SearchResults.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_SearchResults_JsonCodec {
        return Result_SearchResults_JsonCodec.instance
    }
}

export class Result_SearchResults_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_SearchResults): unknown {
        if (this !== Result_SearchResults_JsonCodec.lazyInstance.value) {
          return Result_SearchResults_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "page": SearchPage_JsonCodec.instance.encode(BaboonCodecContext.Default, value.page),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_SearchResults {
        if (this !== Result_SearchResults_JsonCodec .lazyInstance.value) {
            return Result_SearchResults_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_SearchResults (
            SearchPage_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["page"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_SearchResults_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_SearchResults_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#SearchResults'
    public baboonTypeIdentifier() {
        return Result_SearchResults_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_SearchResults_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_SearchResults_JsonCodec())
    public static get instance(): Result_SearchResults_JsonCodec {
        return Result_SearchResults_JsonCodec.lazyInstance.value
    }
}

export class Result_Error implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Result]#Error' as const;
    private readonly _failure: Failure;

    constructor(failure: Failure) {
        this._failure = failure
    }

    public get failure(): Failure {
        return this._failure;
    }

    public toJSON(): Record<string, unknown> {
        return {
            failure: this._failure
        };
    }

    public with(overrides: {failure?: Failure}): Result_Error {
        return new Result_Error(
            'failure' in overrides ? overrides.failure! : this._failure
        );
    }

    public static fromPlain(obj: {failure: Failure}): Result_Error {
        return new Result_Error(
            obj.failure
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_Error.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_Error.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Error'
    public baboonTypeIdentifier() {
        return Result_Error.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Result_Error.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Result_Error.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Result_Error.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Error.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Result_Error_JsonCodec {
        return Result_Error_JsonCodec.instance
    }
}

export class Result_Error_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result_Error): unknown {
        if (this !== Result_Error_JsonCodec.lazyInstance.value) {
          return Result_Error_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "failure": Failure_JsonCodec.instance.encode(BaboonCodecContext.Default, value.failure),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result_Error {
        if (this !== Result_Error_JsonCodec .lazyInstance.value) {
            return Result_Error_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Result_Error (
            Failure_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["failure"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_Error_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_Error_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Result]#Error'
    public baboonTypeIdentifier() {
        return Result_Error_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_Error_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_Error_JsonCodec())
    public static get instance(): Result_Error_JsonCodec {
        return Result_Error_JsonCodec.lazyInstance.value
    }
}


export class Result_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Result): unknown {
        if (this !== Result_JsonCodec.lazyInstance.value) {
          return Result_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof Result_Version) {
                return { "Version": Result_Version_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_CapabilityInfo) {
                return { "CapabilityInfo": Result_CapabilityInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Identity) {
                return { "Identity": Result_Identity_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Ok) {
                return { "Ok": Result_Ok_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Catalogue) {
                return { "Catalogue": Result_Catalogue_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_UploadInitialized) {
                return { "UploadInitialized": Result_UploadInitialized_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_ArtifactInfo) {
                return { "ArtifactInfo": Result_ArtifactInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_ArtifactPatched) {
                return { "ArtifactPatched": Result_ArtifactPatched_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_PasswordRotated) {
                return { "PasswordRotated": Result_PasswordRotated_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_ArtifactManifest) {
                return { "ArtifactManifest": Result_ArtifactManifest_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_UploadProgress) {
                return { "UploadProgress": Result_UploadProgress_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_UploadFinished) {
                return { "UploadFinished": Result_UploadFinished_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_GrantCreated) {
                return { "GrantCreated": Result_GrantCreated_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_SearchResults) {
                return { "SearchResults": Result_SearchResults_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Result_Error) {
                return { "Error": Result_Error_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Result {
        if (this !== Result_JsonCodec .lazyInstance.value) {
            return Result_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Version": return Result_Version_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "CapabilityInfo": return Result_CapabilityInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Identity": return Result_Identity_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Ok": return Result_Ok_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Catalogue": return Result_Catalogue_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "UploadInitialized": return Result_UploadInitialized_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ArtifactInfo": return Result_ArtifactInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ArtifactPatched": return Result_ArtifactPatched_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "PasswordRotated": return Result_PasswordRotated_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ArtifactManifest": return Result_ArtifactManifest_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "UploadProgress": return Result_UploadProgress_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "UploadFinished": return Result_UploadFinished_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "GrantCreated": return Result_GrantCreated_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "SearchResults": return Result_SearchResults_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Error": return Result_Error_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Result_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Result_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#Result'
    public baboonTypeIdentifier() {
        return Result_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Result'
    public baboonAdtTypeIdentifier() {
        return Result_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Result_JsonCodec())
    public static get instance(): Result_JsonCodec {
        return Result_JsonCodec.lazyInstance.value
    }
}