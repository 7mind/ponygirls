import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CredentialMode, CredentialMode_JsonCodec} from './CredentialMode.js'
import {ForgeKind, ForgeKind_JsonCodec} from './ForgeKind.js'
import {RefreshHealth, RefreshHealth_JsonCodec} from './RefreshHealth.js'

export class CredentialInfo implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _name: string;
    private readonly _forge: ForgeKind;
    private readonly _host: string;
    private readonly _revision: number;
    private readonly _createdAt: string;
    private readonly _updatedAt: string;
    private readonly _mode: CredentialMode;
    private readonly _oauthClientId: string | undefined;
    private readonly _expiresAt: string | undefined;
    private readonly _refreshHealth: RefreshHealth | undefined;

    constructor(id: string, name: string, forge: ForgeKind, host: string, revision: number, createdAt: string, updatedAt: string, mode: CredentialMode, oauthClientId: string | undefined, expiresAt: string | undefined, refreshHealth: RefreshHealth | undefined) {
        this._id = id
        this._name = name
        this._forge = forge
        this._host = host
        this._revision = revision
        this._createdAt = createdAt
        this._updatedAt = updatedAt
        this._mode = mode
        this._oauthClientId = oauthClientId
        this._expiresAt = expiresAt
        this._refreshHealth = refreshHealth
    }

    public get id(): string {
        return this._id;
    }
    public get name(): string {
        return this._name;
    }
    public get forge(): ForgeKind {
        return this._forge;
    }
    public get host(): string {
        return this._host;
    }
    public get revision(): number {
        return this._revision;
    }
    public get createdAt(): string {
        return this._createdAt;
    }
    public get updatedAt(): string {
        return this._updatedAt;
    }
    public get mode(): CredentialMode {
        return this._mode;
    }
    public get oauthClientId(): string | undefined {
        return this._oauthClientId;
    }
    public get expiresAt(): string | undefined {
        return this._expiresAt;
    }
    public get refreshHealth(): RefreshHealth | undefined {
        return this._refreshHealth;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            name: this._name,
            forge: this._forge,
            host: this._host,
            revision: this._revision,
            createdAt: this._createdAt,
            updatedAt: this._updatedAt,
            mode: this._mode,
            oauthClientId: this._oauthClientId !== undefined ? this._oauthClientId : undefined,
            expiresAt: this._expiresAt !== undefined ? this._expiresAt : undefined,
            refreshHealth: this._refreshHealth !== undefined ? this._refreshHealth : undefined
        };
    }

    public with(overrides: {id?: string; name?: string; forge?: ForgeKind; host?: string; revision?: number; createdAt?: string; updatedAt?: string; mode?: CredentialMode; oauthClientId?: string | undefined; expiresAt?: string | undefined; refreshHealth?: RefreshHealth | undefined}): CredentialInfo {
        return new CredentialInfo(
            'id' in overrides ? overrides.id! : this._id,
            'name' in overrides ? overrides.name! : this._name,
            'forge' in overrides ? overrides.forge! : this._forge,
            'host' in overrides ? overrides.host! : this._host,
            'revision' in overrides ? overrides.revision! : this._revision,
            'createdAt' in overrides ? overrides.createdAt! : this._createdAt,
            'updatedAt' in overrides ? overrides.updatedAt! : this._updatedAt,
            'mode' in overrides ? overrides.mode! : this._mode,
            'oauthClientId' in overrides ? overrides.oauthClientId! : this._oauthClientId,
            'expiresAt' in overrides ? overrides.expiresAt! : this._expiresAt,
            'refreshHealth' in overrides ? overrides.refreshHealth! : this._refreshHealth
        );
    }

    public static fromPlain(obj: {id: string; name: string; forge: ForgeKind; host: string; revision: number; createdAt: string; updatedAt: string; mode: CredentialMode; oauthClientId: string | undefined; expiresAt: string | undefined; refreshHealth: RefreshHealth | undefined}): CredentialInfo {
        return new CredentialInfo(
            obj.id,
            obj.name,
            obj.forge,
            obj.host,
            obj.revision,
            obj.createdAt,
            obj.updatedAt,
            obj.mode,
            obj.oauthClientId,
            obj.expiresAt,
            obj.refreshHealth
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return CredentialInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return CredentialInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#CredentialInfo'
    public baboonTypeIdentifier() {
        return CredentialInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return CredentialInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return CredentialInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return CredentialInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): CredentialInfo_JsonCodec {
        return CredentialInfo_JsonCodec.instance
    }
}

export class CredentialInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CredentialInfo): unknown {
        if (this !== CredentialInfo_JsonCodec.lazyInstance.value) {
          return CredentialInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "name": value.name,
            "forge": ForgeKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.forge),
            "host": value.host,
            "revision": value.revision,
            "createdAt": value.createdAt,
            "updatedAt": value.updatedAt,
            "mode": CredentialMode_JsonCodec.instance.encode(BaboonCodecContext.Default, value.mode),
            "oauthClientId": value.oauthClientId === undefined ? null : value.oauthClientId,
            "expiresAt": value.expiresAt === undefined ? null : value.expiresAt,
            "refreshHealth": value.refreshHealth === undefined ? null : RefreshHealth_JsonCodec.instance.encode(BaboonCodecContext.Default, value.refreshHealth),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CredentialInfo {
        if (this !== CredentialInfo_JsonCodec .lazyInstance.value) {
            return CredentialInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CredentialInfo (
            obj["id"] as string,
            obj["name"] as string,
            ForgeKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["forge"]),
            obj["host"] as string,
            obj["revision"] as number,
            obj["createdAt"] as string,
            obj["updatedAt"] as string,
            CredentialMode_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["mode"]),
            obj["oauthClientId"] === undefined || obj["oauthClientId"] === null ? undefined : obj["oauthClientId"] === undefined || obj["oauthClientId"] === null ? undefined : obj["oauthClientId"] as string,
            obj["expiresAt"] === undefined || obj["expiresAt"] === null ? undefined : obj["expiresAt"] === undefined || obj["expiresAt"] === null ? undefined : obj["expiresAt"] as string,
            obj["refreshHealth"] === undefined || obj["refreshHealth"] === null ? undefined : obj["refreshHealth"] === undefined || obj["refreshHealth"] === null ? undefined : RefreshHealth_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["refreshHealth"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return CredentialInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return CredentialInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#CredentialInfo'
    public baboonTypeIdentifier() {
        return CredentialInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CredentialInfo_JsonCodec())
    public static get instance(): CredentialInfo_JsonCodec {
        return CredentialInfo_JsonCodec.lazyInstance.value
    }
}