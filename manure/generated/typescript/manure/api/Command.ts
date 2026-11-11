import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ArtifactKind, ArtifactKind_JsonCodec} from './ArtifactKind.js'
import {ArtifactPatch, ArtifactPatch_JsonCodec} from './ArtifactPatch.js'
import {CatalogueQuery, CatalogueQuery_JsonCodec} from './CatalogueQuery.js'
import {ManifestEntry, ManifestEntry_JsonCodec} from './ManifestEntry.js'
import {SearchQuery, SearchQuery_JsonCodec} from './SearchQuery.js'
import {Visibility, Visibility_JsonCodec} from './Visibility.js'

export type Command = Command_Version | Command_GetCapabilities | Command_Login | Command_Logout | Command_Whoami | Command_ListArtifacts | Command_InitUpload | Command_GetArtifact | Command_PatchArtifact | Command_DeleteArtifact | Command_RotateExternalPassword | Command_GetExternalPassword | Command_GetManifest | Command_GetUploadStatus | Command_FinishUpload | Command_CreateGrant | Command_Search

export const Command = {
    BaboonDomainVersion: '1.0.0',
    BaboonDomainIdentifier: 'manure.api',
    BaboonTypeIdentifier: 'manure.api/:#Command',
    BaboonSameInVersions: ["1.0.0"],
    BaboonForwardReadable: { "1.0.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'manure.api/:#Command',
    jsonCodec(): Command_JsonCodec {
        return Command_JsonCodec.instance
    }
} as const

export class Command_Version implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#Version' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): Command_Version {
        return new Command_Version(
            
        );
    }

    public static fromPlain(obj: {}): Command_Version {
        return new Command_Version(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_Version.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_Version.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Version'
    public baboonTypeIdentifier() {
        return Command_Version.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_Version.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_Version.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_Version.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_Version.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_Version_JsonCodec {
        return Command_Version_JsonCodec.instance
    }
}

export class Command_Version_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_Version): unknown {
        if (this !== Command_Version_JsonCodec.lazyInstance.value) {
          return Command_Version_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_Version {
        if (this !== Command_Version_JsonCodec .lazyInstance.value) {
            return Command_Version_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_Version (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_Version_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_Version_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Version'
    public baboonTypeIdentifier() {
        return Command_Version_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_Version_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_Version_JsonCodec())
    public static get instance(): Command_Version_JsonCodec {
        return Command_Version_JsonCodec.lazyInstance.value
    }
}

export class Command_GetCapabilities implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#GetCapabilities' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): Command_GetCapabilities {
        return new Command_GetCapabilities(
            
        );
    }

    public static fromPlain(obj: {}): Command_GetCapabilities {
        return new Command_GetCapabilities(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_GetCapabilities.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_GetCapabilities.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetCapabilities'
    public baboonTypeIdentifier() {
        return Command_GetCapabilities.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_GetCapabilities.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_GetCapabilities.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_GetCapabilities.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_GetCapabilities.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_GetCapabilities_JsonCodec {
        return Command_GetCapabilities_JsonCodec.instance
    }
}

export class Command_GetCapabilities_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_GetCapabilities): unknown {
        if (this !== Command_GetCapabilities_JsonCodec.lazyInstance.value) {
          return Command_GetCapabilities_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_GetCapabilities {
        if (this !== Command_GetCapabilities_JsonCodec .lazyInstance.value) {
            return Command_GetCapabilities_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_GetCapabilities (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_GetCapabilities_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_GetCapabilities_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetCapabilities'
    public baboonTypeIdentifier() {
        return Command_GetCapabilities_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_GetCapabilities_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_GetCapabilities_JsonCodec())
    public static get instance(): Command_GetCapabilities_JsonCodec {
        return Command_GetCapabilities_JsonCodec.lazyInstance.value
    }
}

export class Command_Login implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#Login' as const;
    private readonly _token: string;

    constructor(token: string) {
        this._token = token
    }

    public get token(): string {
        return this._token;
    }

    public toJSON(): Record<string, unknown> {
        return {
            token: this._token
        };
    }

    public with(overrides: {token?: string}): Command_Login {
        return new Command_Login(
            'token' in overrides ? overrides.token! : this._token
        );
    }

    public static fromPlain(obj: {token: string}): Command_Login {
        return new Command_Login(
            obj.token
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_Login.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_Login.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Login'
    public baboonTypeIdentifier() {
        return Command_Login.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_Login.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_Login.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_Login.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_Login.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_Login_JsonCodec {
        return Command_Login_JsonCodec.instance
    }
}

export class Command_Login_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_Login): unknown {
        if (this !== Command_Login_JsonCodec.lazyInstance.value) {
          return Command_Login_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "token": value.token,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_Login {
        if (this !== Command_Login_JsonCodec .lazyInstance.value) {
            return Command_Login_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_Login (
            obj["token"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_Login_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_Login_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Login'
    public baboonTypeIdentifier() {
        return Command_Login_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_Login_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_Login_JsonCodec())
    public static get instance(): Command_Login_JsonCodec {
        return Command_Login_JsonCodec.lazyInstance.value
    }
}

export class Command_Logout implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#Logout' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): Command_Logout {
        return new Command_Logout(
            
        );
    }

    public static fromPlain(obj: {}): Command_Logout {
        return new Command_Logout(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_Logout.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_Logout.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Logout'
    public baboonTypeIdentifier() {
        return Command_Logout.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_Logout.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_Logout.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_Logout.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_Logout.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_Logout_JsonCodec {
        return Command_Logout_JsonCodec.instance
    }
}

export class Command_Logout_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_Logout): unknown {
        if (this !== Command_Logout_JsonCodec.lazyInstance.value) {
          return Command_Logout_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_Logout {
        if (this !== Command_Logout_JsonCodec .lazyInstance.value) {
            return Command_Logout_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_Logout (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_Logout_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_Logout_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Logout'
    public baboonTypeIdentifier() {
        return Command_Logout_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_Logout_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_Logout_JsonCodec())
    public static get instance(): Command_Logout_JsonCodec {
        return Command_Logout_JsonCodec.lazyInstance.value
    }
}

export class Command_Whoami implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#Whoami' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): Command_Whoami {
        return new Command_Whoami(
            
        );
    }

    public static fromPlain(obj: {}): Command_Whoami {
        return new Command_Whoami(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_Whoami.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_Whoami.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Whoami'
    public baboonTypeIdentifier() {
        return Command_Whoami.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_Whoami.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_Whoami.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_Whoami.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_Whoami.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_Whoami_JsonCodec {
        return Command_Whoami_JsonCodec.instance
    }
}

export class Command_Whoami_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_Whoami): unknown {
        if (this !== Command_Whoami_JsonCodec.lazyInstance.value) {
          return Command_Whoami_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_Whoami {
        if (this !== Command_Whoami_JsonCodec .lazyInstance.value) {
            return Command_Whoami_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_Whoami (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_Whoami_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_Whoami_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Whoami'
    public baboonTypeIdentifier() {
        return Command_Whoami_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_Whoami_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_Whoami_JsonCodec())
    public static get instance(): Command_Whoami_JsonCodec {
        return Command_Whoami_JsonCodec.lazyInstance.value
    }
}

export class Command_ListArtifacts implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#ListArtifacts' as const;
    private readonly _query: CatalogueQuery;

    constructor(query: CatalogueQuery) {
        this._query = query
    }

    public get query(): CatalogueQuery {
        return this._query;
    }

    public toJSON(): Record<string, unknown> {
        return {
            query: this._query
        };
    }

    public with(overrides: {query?: CatalogueQuery}): Command_ListArtifacts {
        return new Command_ListArtifacts(
            'query' in overrides ? overrides.query! : this._query
        );
    }

    public static fromPlain(obj: {query: CatalogueQuery}): Command_ListArtifacts {
        return new Command_ListArtifacts(
            obj.query
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_ListArtifacts.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_ListArtifacts.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#ListArtifacts'
    public baboonTypeIdentifier() {
        return Command_ListArtifacts.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_ListArtifacts.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_ListArtifacts.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_ListArtifacts.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_ListArtifacts.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_ListArtifacts_JsonCodec {
        return Command_ListArtifacts_JsonCodec.instance
    }
}

export class Command_ListArtifacts_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_ListArtifacts): unknown {
        if (this !== Command_ListArtifacts_JsonCodec.lazyInstance.value) {
          return Command_ListArtifacts_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "query": CatalogueQuery_JsonCodec.instance.encode(BaboonCodecContext.Default, value.query),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_ListArtifacts {
        if (this !== Command_ListArtifacts_JsonCodec .lazyInstance.value) {
            return Command_ListArtifacts_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_ListArtifacts (
            CatalogueQuery_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["query"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_ListArtifacts_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_ListArtifacts_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#ListArtifacts'
    public baboonTypeIdentifier() {
        return Command_ListArtifacts_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_ListArtifacts_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_ListArtifacts_JsonCodec())
    public static get instance(): Command_ListArtifacts_JsonCodec {
        return Command_ListArtifacts_JsonCodec.lazyInstance.value
    }
}

export class Command_InitUpload implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#InitUpload' as const;
    private readonly _name: string;
    private readonly _kind: ArtifactKind;
    private readonly _visibility: Visibility;
    private readonly _expiresInSeconds: number | undefined;
    private readonly _files: Array<ManifestEntry>;
    private readonly _tags: Array<string>;
    private readonly _hostname: string | undefined;
    private readonly _projectPath: string | undefined;

    constructor(name: string, kind: ArtifactKind, visibility: Visibility, expiresInSeconds: number | undefined, files: Array<ManifestEntry>, tags: Array<string>, hostname: string | undefined, projectPath: string | undefined) {
        this._name = name
        this._kind = kind
        this._visibility = visibility
        this._expiresInSeconds = expiresInSeconds
        this._files = files
        this._tags = tags
        this._hostname = hostname
        this._projectPath = projectPath
    }

    public get name(): string {
        return this._name;
    }
    public get kind(): ArtifactKind {
        return this._kind;
    }
    public get visibility(): Visibility {
        return this._visibility;
    }
    public get expiresInSeconds(): number | undefined {
        return this._expiresInSeconds;
    }
    public get files(): Array<ManifestEntry> {
        return this._files;
    }
    public get tags(): Array<string> {
        return this._tags;
    }
    public get hostname(): string | undefined {
        return this._hostname;
    }
    public get projectPath(): string | undefined {
        return this._projectPath;
    }

    public toJSON(): Record<string, unknown> {
        return {
            name: this._name,
            kind: this._kind,
            visibility: this._visibility,
            expiresInSeconds: this._expiresInSeconds !== undefined ? this._expiresInSeconds : undefined,
            files: this._files,
            tags: this._tags,
            hostname: this._hostname !== undefined ? this._hostname : undefined,
            projectPath: this._projectPath !== undefined ? this._projectPath : undefined
        };
    }

    public with(overrides: {name?: string; kind?: ArtifactKind; visibility?: Visibility; expiresInSeconds?: number | undefined; files?: Array<ManifestEntry>; tags?: Array<string>; hostname?: string | undefined; projectPath?: string | undefined}): Command_InitUpload {
        return new Command_InitUpload(
            'name' in overrides ? overrides.name! : this._name,
            'kind' in overrides ? overrides.kind! : this._kind,
            'visibility' in overrides ? overrides.visibility! : this._visibility,
            'expiresInSeconds' in overrides ? overrides.expiresInSeconds! : this._expiresInSeconds,
            'files' in overrides ? overrides.files! : this._files,
            'tags' in overrides ? overrides.tags! : this._tags,
            'hostname' in overrides ? overrides.hostname! : this._hostname,
            'projectPath' in overrides ? overrides.projectPath! : this._projectPath
        );
    }

    public static fromPlain(obj: {name: string; kind: ArtifactKind; visibility: Visibility; expiresInSeconds: number | undefined; files: Array<ManifestEntry>; tags: Array<string>; hostname: string | undefined; projectPath: string | undefined}): Command_InitUpload {
        return new Command_InitUpload(
            obj.name,
            obj.kind,
            obj.visibility,
            obj.expiresInSeconds,
            obj.files,
            obj.tags,
            obj.hostname,
            obj.projectPath
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_InitUpload.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_InitUpload.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#InitUpload'
    public baboonTypeIdentifier() {
        return Command_InitUpload.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_InitUpload.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_InitUpload.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_InitUpload.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_InitUpload.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_InitUpload_JsonCodec {
        return Command_InitUpload_JsonCodec.instance
    }
}

export class Command_InitUpload_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_InitUpload): unknown {
        if (this !== Command_InitUpload_JsonCodec.lazyInstance.value) {
          return Command_InitUpload_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "name": value.name,
            "kind": ArtifactKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
            "visibility": Visibility_JsonCodec.instance.encode(BaboonCodecContext.Default, value.visibility),
            "expiresInSeconds": value.expiresInSeconds === undefined ? null : value.expiresInSeconds,
            "files": Array.from(value.files).map(item => ManifestEntry_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "tags": Array.from(value.tags),
            "hostname": value.hostname === undefined ? null : value.hostname,
            "projectPath": value.projectPath === undefined ? null : value.projectPath,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_InitUpload {
        if (this !== Command_InitUpload_JsonCodec .lazyInstance.value) {
            return Command_InitUpload_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_InitUpload (
            obj["name"] as string,
            ArtifactKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]),
            Visibility_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["visibility"]),
            obj["expiresInSeconds"] === undefined || obj["expiresInSeconds"] === null ? undefined : obj["expiresInSeconds"] === undefined || obj["expiresInSeconds"] === null ? undefined : obj["expiresInSeconds"] as number,
            (obj["files"] as unknown[]).map(item => ManifestEntry_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["tags"] as unknown[]).map(item => item as string),
            obj["hostname"] === undefined || obj["hostname"] === null ? undefined : obj["hostname"] === undefined || obj["hostname"] === null ? undefined : obj["hostname"] as string,
            obj["projectPath"] === undefined || obj["projectPath"] === null ? undefined : obj["projectPath"] === undefined || obj["projectPath"] === null ? undefined : obj["projectPath"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_InitUpload_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_InitUpload_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#InitUpload'
    public baboonTypeIdentifier() {
        return Command_InitUpload_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_InitUpload_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_InitUpload_JsonCodec())
    public static get instance(): Command_InitUpload_JsonCodec {
        return Command_InitUpload_JsonCodec.lazyInstance.value
    }
}

export class Command_GetArtifact implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#GetArtifact' as const;
    private readonly _artifactId: string;

    constructor(artifactId: string) {
        this._artifactId = artifactId
    }

    public get artifactId(): string {
        return this._artifactId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifactId: this._artifactId
        };
    }

    public with(overrides: {artifactId?: string}): Command_GetArtifact {
        return new Command_GetArtifact(
            'artifactId' in overrides ? overrides.artifactId! : this._artifactId
        );
    }

    public static fromPlain(obj: {artifactId: string}): Command_GetArtifact {
        return new Command_GetArtifact(
            obj.artifactId
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_GetArtifact.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_GetArtifact.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetArtifact'
    public baboonTypeIdentifier() {
        return Command_GetArtifact.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_GetArtifact.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_GetArtifact.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_GetArtifact.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_GetArtifact.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_GetArtifact_JsonCodec {
        return Command_GetArtifact_JsonCodec.instance
    }
}

export class Command_GetArtifact_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_GetArtifact): unknown {
        if (this !== Command_GetArtifact_JsonCodec.lazyInstance.value) {
          return Command_GetArtifact_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifactId": value.artifactId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_GetArtifact {
        if (this !== Command_GetArtifact_JsonCodec .lazyInstance.value) {
            return Command_GetArtifact_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_GetArtifact (
            obj["artifactId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_GetArtifact_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_GetArtifact_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetArtifact'
    public baboonTypeIdentifier() {
        return Command_GetArtifact_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_GetArtifact_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_GetArtifact_JsonCodec())
    public static get instance(): Command_GetArtifact_JsonCodec {
        return Command_GetArtifact_JsonCodec.lazyInstance.value
    }
}

export class Command_PatchArtifact implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#PatchArtifact' as const;
    private readonly _artifactId: string;
    private readonly _patch: ArtifactPatch;

    constructor(artifactId: string, patch: ArtifactPatch) {
        this._artifactId = artifactId
        this._patch = patch
    }

    public get artifactId(): string {
        return this._artifactId;
    }
    public get patch(): ArtifactPatch {
        return this._patch;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifactId: this._artifactId,
            patch: this._patch
        };
    }

    public with(overrides: {artifactId?: string; patch?: ArtifactPatch}): Command_PatchArtifact {
        return new Command_PatchArtifact(
            'artifactId' in overrides ? overrides.artifactId! : this._artifactId,
            'patch' in overrides ? overrides.patch! : this._patch
        );
    }

    public static fromPlain(obj: {artifactId: string; patch: ArtifactPatch}): Command_PatchArtifact {
        return new Command_PatchArtifact(
            obj.artifactId,
            obj.patch
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_PatchArtifact.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_PatchArtifact.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#PatchArtifact'
    public baboonTypeIdentifier() {
        return Command_PatchArtifact.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_PatchArtifact.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_PatchArtifact.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_PatchArtifact.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_PatchArtifact.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_PatchArtifact_JsonCodec {
        return Command_PatchArtifact_JsonCodec.instance
    }
}

export class Command_PatchArtifact_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_PatchArtifact): unknown {
        if (this !== Command_PatchArtifact_JsonCodec.lazyInstance.value) {
          return Command_PatchArtifact_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifactId": value.artifactId,
            "patch": ArtifactPatch_JsonCodec.instance.encode(BaboonCodecContext.Default, value.patch),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_PatchArtifact {
        if (this !== Command_PatchArtifact_JsonCodec .lazyInstance.value) {
            return Command_PatchArtifact_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_PatchArtifact (
            obj["artifactId"] as string,
            ArtifactPatch_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["patch"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_PatchArtifact_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_PatchArtifact_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#PatchArtifact'
    public baboonTypeIdentifier() {
        return Command_PatchArtifact_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_PatchArtifact_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_PatchArtifact_JsonCodec())
    public static get instance(): Command_PatchArtifact_JsonCodec {
        return Command_PatchArtifact_JsonCodec.lazyInstance.value
    }
}

export class Command_DeleteArtifact implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#DeleteArtifact' as const;
    private readonly _artifactId: string;

    constructor(artifactId: string) {
        this._artifactId = artifactId
    }

    public get artifactId(): string {
        return this._artifactId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifactId: this._artifactId
        };
    }

    public with(overrides: {artifactId?: string}): Command_DeleteArtifact {
        return new Command_DeleteArtifact(
            'artifactId' in overrides ? overrides.artifactId! : this._artifactId
        );
    }

    public static fromPlain(obj: {artifactId: string}): Command_DeleteArtifact {
        return new Command_DeleteArtifact(
            obj.artifactId
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_DeleteArtifact.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_DeleteArtifact.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#DeleteArtifact'
    public baboonTypeIdentifier() {
        return Command_DeleteArtifact.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_DeleteArtifact.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_DeleteArtifact.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_DeleteArtifact.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_DeleteArtifact.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_DeleteArtifact_JsonCodec {
        return Command_DeleteArtifact_JsonCodec.instance
    }
}

export class Command_DeleteArtifact_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_DeleteArtifact): unknown {
        if (this !== Command_DeleteArtifact_JsonCodec.lazyInstance.value) {
          return Command_DeleteArtifact_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifactId": value.artifactId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_DeleteArtifact {
        if (this !== Command_DeleteArtifact_JsonCodec .lazyInstance.value) {
            return Command_DeleteArtifact_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_DeleteArtifact (
            obj["artifactId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_DeleteArtifact_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_DeleteArtifact_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#DeleteArtifact'
    public baboonTypeIdentifier() {
        return Command_DeleteArtifact_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_DeleteArtifact_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_DeleteArtifact_JsonCodec())
    public static get instance(): Command_DeleteArtifact_JsonCodec {
        return Command_DeleteArtifact_JsonCodec.lazyInstance.value
    }
}

export class Command_RotateExternalPassword implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#RotateExternalPassword' as const;
    private readonly _artifactId: string;

    constructor(artifactId: string) {
        this._artifactId = artifactId
    }

    public get artifactId(): string {
        return this._artifactId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifactId: this._artifactId
        };
    }

    public with(overrides: {artifactId?: string}): Command_RotateExternalPassword {
        return new Command_RotateExternalPassword(
            'artifactId' in overrides ? overrides.artifactId! : this._artifactId
        );
    }

    public static fromPlain(obj: {artifactId: string}): Command_RotateExternalPassword {
        return new Command_RotateExternalPassword(
            obj.artifactId
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_RotateExternalPassword.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_RotateExternalPassword.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#RotateExternalPassword'
    public baboonTypeIdentifier() {
        return Command_RotateExternalPassword.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_RotateExternalPassword.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_RotateExternalPassword.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_RotateExternalPassword.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_RotateExternalPassword.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_RotateExternalPassword_JsonCodec {
        return Command_RotateExternalPassword_JsonCodec.instance
    }
}

export class Command_RotateExternalPassword_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_RotateExternalPassword): unknown {
        if (this !== Command_RotateExternalPassword_JsonCodec.lazyInstance.value) {
          return Command_RotateExternalPassword_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifactId": value.artifactId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_RotateExternalPassword {
        if (this !== Command_RotateExternalPassword_JsonCodec .lazyInstance.value) {
            return Command_RotateExternalPassword_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_RotateExternalPassword (
            obj["artifactId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_RotateExternalPassword_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_RotateExternalPassword_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#RotateExternalPassword'
    public baboonTypeIdentifier() {
        return Command_RotateExternalPassword_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_RotateExternalPassword_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_RotateExternalPassword_JsonCodec())
    public static get instance(): Command_RotateExternalPassword_JsonCodec {
        return Command_RotateExternalPassword_JsonCodec.lazyInstance.value
    }
}

export class Command_GetExternalPassword implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#GetExternalPassword' as const;
    private readonly _artifactId: string;

    constructor(artifactId: string) {
        this._artifactId = artifactId
    }

    public get artifactId(): string {
        return this._artifactId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifactId: this._artifactId
        };
    }

    public with(overrides: {artifactId?: string}): Command_GetExternalPassword {
        return new Command_GetExternalPassword(
            'artifactId' in overrides ? overrides.artifactId! : this._artifactId
        );
    }

    public static fromPlain(obj: {artifactId: string}): Command_GetExternalPassword {
        return new Command_GetExternalPassword(
            obj.artifactId
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_GetExternalPassword.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_GetExternalPassword.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetExternalPassword'
    public baboonTypeIdentifier() {
        return Command_GetExternalPassword.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_GetExternalPassword.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_GetExternalPassword.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_GetExternalPassword.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_GetExternalPassword.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_GetExternalPassword_JsonCodec {
        return Command_GetExternalPassword_JsonCodec.instance
    }
}

export class Command_GetExternalPassword_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_GetExternalPassword): unknown {
        if (this !== Command_GetExternalPassword_JsonCodec.lazyInstance.value) {
          return Command_GetExternalPassword_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifactId": value.artifactId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_GetExternalPassword {
        if (this !== Command_GetExternalPassword_JsonCodec .lazyInstance.value) {
            return Command_GetExternalPassword_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_GetExternalPassword (
            obj["artifactId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_GetExternalPassword_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_GetExternalPassword_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetExternalPassword'
    public baboonTypeIdentifier() {
        return Command_GetExternalPassword_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_GetExternalPassword_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_GetExternalPassword_JsonCodec())
    public static get instance(): Command_GetExternalPassword_JsonCodec {
        return Command_GetExternalPassword_JsonCodec.lazyInstance.value
    }
}

export class Command_GetManifest implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#GetManifest' as const;
    private readonly _artifactId: string;

    constructor(artifactId: string) {
        this._artifactId = artifactId
    }

    public get artifactId(): string {
        return this._artifactId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifactId: this._artifactId
        };
    }

    public with(overrides: {artifactId?: string}): Command_GetManifest {
        return new Command_GetManifest(
            'artifactId' in overrides ? overrides.artifactId! : this._artifactId
        );
    }

    public static fromPlain(obj: {artifactId: string}): Command_GetManifest {
        return new Command_GetManifest(
            obj.artifactId
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_GetManifest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_GetManifest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetManifest'
    public baboonTypeIdentifier() {
        return Command_GetManifest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_GetManifest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_GetManifest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_GetManifest.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_GetManifest.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_GetManifest_JsonCodec {
        return Command_GetManifest_JsonCodec.instance
    }
}

export class Command_GetManifest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_GetManifest): unknown {
        if (this !== Command_GetManifest_JsonCodec.lazyInstance.value) {
          return Command_GetManifest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifactId": value.artifactId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_GetManifest {
        if (this !== Command_GetManifest_JsonCodec .lazyInstance.value) {
            return Command_GetManifest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_GetManifest (
            obj["artifactId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_GetManifest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_GetManifest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetManifest'
    public baboonTypeIdentifier() {
        return Command_GetManifest_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_GetManifest_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_GetManifest_JsonCodec())
    public static get instance(): Command_GetManifest_JsonCodec {
        return Command_GetManifest_JsonCodec.lazyInstance.value
    }
}

export class Command_GetUploadStatus implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#GetUploadStatus' as const;
    private readonly _artifactId: string;

    constructor(artifactId: string) {
        this._artifactId = artifactId
    }

    public get artifactId(): string {
        return this._artifactId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifactId: this._artifactId
        };
    }

    public with(overrides: {artifactId?: string}): Command_GetUploadStatus {
        return new Command_GetUploadStatus(
            'artifactId' in overrides ? overrides.artifactId! : this._artifactId
        );
    }

    public static fromPlain(obj: {artifactId: string}): Command_GetUploadStatus {
        return new Command_GetUploadStatus(
            obj.artifactId
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_GetUploadStatus.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_GetUploadStatus.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetUploadStatus'
    public baboonTypeIdentifier() {
        return Command_GetUploadStatus.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_GetUploadStatus.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_GetUploadStatus.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_GetUploadStatus.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_GetUploadStatus.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_GetUploadStatus_JsonCodec {
        return Command_GetUploadStatus_JsonCodec.instance
    }
}

export class Command_GetUploadStatus_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_GetUploadStatus): unknown {
        if (this !== Command_GetUploadStatus_JsonCodec.lazyInstance.value) {
          return Command_GetUploadStatus_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifactId": value.artifactId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_GetUploadStatus {
        if (this !== Command_GetUploadStatus_JsonCodec .lazyInstance.value) {
            return Command_GetUploadStatus_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_GetUploadStatus (
            obj["artifactId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_GetUploadStatus_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_GetUploadStatus_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#GetUploadStatus'
    public baboonTypeIdentifier() {
        return Command_GetUploadStatus_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_GetUploadStatus_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_GetUploadStatus_JsonCodec())
    public static get instance(): Command_GetUploadStatus_JsonCodec {
        return Command_GetUploadStatus_JsonCodec.lazyInstance.value
    }
}

export class Command_FinishUpload implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#FinishUpload' as const;
    private readonly _artifactId: string;

    constructor(artifactId: string) {
        this._artifactId = artifactId
    }

    public get artifactId(): string {
        return this._artifactId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifactId: this._artifactId
        };
    }

    public with(overrides: {artifactId?: string}): Command_FinishUpload {
        return new Command_FinishUpload(
            'artifactId' in overrides ? overrides.artifactId! : this._artifactId
        );
    }

    public static fromPlain(obj: {artifactId: string}): Command_FinishUpload {
        return new Command_FinishUpload(
            obj.artifactId
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_FinishUpload.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_FinishUpload.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#FinishUpload'
    public baboonTypeIdentifier() {
        return Command_FinishUpload.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_FinishUpload.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_FinishUpload.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_FinishUpload.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_FinishUpload.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_FinishUpload_JsonCodec {
        return Command_FinishUpload_JsonCodec.instance
    }
}

export class Command_FinishUpload_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_FinishUpload): unknown {
        if (this !== Command_FinishUpload_JsonCodec.lazyInstance.value) {
          return Command_FinishUpload_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifactId": value.artifactId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_FinishUpload {
        if (this !== Command_FinishUpload_JsonCodec .lazyInstance.value) {
            return Command_FinishUpload_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_FinishUpload (
            obj["artifactId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_FinishUpload_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_FinishUpload_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#FinishUpload'
    public baboonTypeIdentifier() {
        return Command_FinishUpload_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_FinishUpload_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_FinishUpload_JsonCodec())
    public static get instance(): Command_FinishUpload_JsonCodec {
        return Command_FinishUpload_JsonCodec.lazyInstance.value
    }
}

export class Command_CreateGrant implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#CreateGrant' as const;
    private readonly _artifactId: string;

    constructor(artifactId: string) {
        this._artifactId = artifactId
    }

    public get artifactId(): string {
        return this._artifactId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifactId: this._artifactId
        };
    }

    public with(overrides: {artifactId?: string}): Command_CreateGrant {
        return new Command_CreateGrant(
            'artifactId' in overrides ? overrides.artifactId! : this._artifactId
        );
    }

    public static fromPlain(obj: {artifactId: string}): Command_CreateGrant {
        return new Command_CreateGrant(
            obj.artifactId
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_CreateGrant.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_CreateGrant.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#CreateGrant'
    public baboonTypeIdentifier() {
        return Command_CreateGrant.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_CreateGrant.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_CreateGrant.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_CreateGrant.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_CreateGrant.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_CreateGrant_JsonCodec {
        return Command_CreateGrant_JsonCodec.instance
    }
}

export class Command_CreateGrant_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_CreateGrant): unknown {
        if (this !== Command_CreateGrant_JsonCodec.lazyInstance.value) {
          return Command_CreateGrant_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifactId": value.artifactId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_CreateGrant {
        if (this !== Command_CreateGrant_JsonCodec .lazyInstance.value) {
            return Command_CreateGrant_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_CreateGrant (
            obj["artifactId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_CreateGrant_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_CreateGrant_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#CreateGrant'
    public baboonTypeIdentifier() {
        return Command_CreateGrant_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_CreateGrant_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_CreateGrant_JsonCodec())
    public static get instance(): Command_CreateGrant_JsonCodec {
        return Command_CreateGrant_JsonCodec.lazyInstance.value
    }
}

export class Command_Search implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#Command]#Search' as const;
    private readonly _query: SearchQuery;

    constructor(query: SearchQuery) {
        this._query = query
    }

    public get query(): SearchQuery {
        return this._query;
    }

    public toJSON(): Record<string, unknown> {
        return {
            query: this._query
        };
    }

    public with(overrides: {query?: SearchQuery}): Command_Search {
        return new Command_Search(
            'query' in overrides ? overrides.query! : this._query
        );
    }

    public static fromPlain(obj: {query: SearchQuery}): Command_Search {
        return new Command_Search(
            obj.query
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_Search.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_Search.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Search'
    public baboonTypeIdentifier() {
        return Command_Search.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Command_Search.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Command_Search.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Command_Search.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_Search.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Command_Search_JsonCodec {
        return Command_Search_JsonCodec.instance
    }
}

export class Command_Search_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command_Search): unknown {
        if (this !== Command_Search_JsonCodec.lazyInstance.value) {
          return Command_Search_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "query": SearchQuery_JsonCodec.instance.encode(BaboonCodecContext.Default, value.query),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command_Search {
        if (this !== Command_Search_JsonCodec .lazyInstance.value) {
            return Command_Search_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Command_Search (
            SearchQuery_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["query"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_Search_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_Search_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#Command]#Search'
    public baboonTypeIdentifier() {
        return Command_Search_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_Search_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_Search_JsonCodec())
    public static get instance(): Command_Search_JsonCodec {
        return Command_Search_JsonCodec.lazyInstance.value
    }
}


export class Command_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Command): unknown {
        if (this !== Command_JsonCodec.lazyInstance.value) {
          return Command_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof Command_Version) {
                return { "Version": Command_Version_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_GetCapabilities) {
                return { "GetCapabilities": Command_GetCapabilities_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_Login) {
                return { "Login": Command_Login_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_Logout) {
                return { "Logout": Command_Logout_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_Whoami) {
                return { "Whoami": Command_Whoami_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_ListArtifacts) {
                return { "ListArtifacts": Command_ListArtifacts_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_InitUpload) {
                return { "InitUpload": Command_InitUpload_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_GetArtifact) {
                return { "GetArtifact": Command_GetArtifact_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_PatchArtifact) {
                return { "PatchArtifact": Command_PatchArtifact_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_DeleteArtifact) {
                return { "DeleteArtifact": Command_DeleteArtifact_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_RotateExternalPassword) {
                return { "RotateExternalPassword": Command_RotateExternalPassword_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_GetExternalPassword) {
                return { "GetExternalPassword": Command_GetExternalPassword_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_GetManifest) {
                return { "GetManifest": Command_GetManifest_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_GetUploadStatus) {
                return { "GetUploadStatus": Command_GetUploadStatus_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_FinishUpload) {
                return { "FinishUpload": Command_FinishUpload_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_CreateGrant) {
                return { "CreateGrant": Command_CreateGrant_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Command_Search) {
                return { "Search": Command_Search_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Command {
        if (this !== Command_JsonCodec .lazyInstance.value) {
            return Command_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Version": return Command_Version_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "GetCapabilities": return Command_GetCapabilities_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Login": return Command_Login_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Logout": return Command_Logout_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Whoami": return Command_Whoami_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ListArtifacts": return Command_ListArtifacts_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "InitUpload": return Command_InitUpload_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "GetArtifact": return Command_GetArtifact_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "PatchArtifact": return Command_PatchArtifact_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "DeleteArtifact": return Command_DeleteArtifact_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "RotateExternalPassword": return Command_RotateExternalPassword_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "GetExternalPassword": return Command_GetExternalPassword_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "GetManifest": return Command_GetManifest_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "GetUploadStatus": return Command_GetUploadStatus_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "FinishUpload": return Command_FinishUpload_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "CreateGrant": return Command_CreateGrant_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Search": return Command_Search_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Command_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Command_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#Command'
    public baboonTypeIdentifier() {
        return Command_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#Command'
    public baboonAdtTypeIdentifier() {
        return Command_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Command_JsonCodec())
    public static get instance(): Command_JsonCodec {
        return Command_JsonCodec.lazyInstance.value
    }
}