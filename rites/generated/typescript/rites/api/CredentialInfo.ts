import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ForgeKind, ForgeKind_JsonCodec} from './ForgeKind.js'

export class CredentialInfo implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _name: string;
    private readonly _forge: ForgeKind;
    private readonly _host: string;
    private readonly _revision: number;
    private readonly _createdAt: string;
    private readonly _updatedAt: string;

    constructor(id: string, name: string, forge: ForgeKind, host: string, revision: number, createdAt: string, updatedAt: string) {
        this._id = id
        this._name = name
        this._forge = forge
        this._host = host
        this._revision = revision
        this._createdAt = createdAt
        this._updatedAt = updatedAt
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

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            name: this._name,
            forge: this._forge,
            host: this._host,
            revision: this._revision,
            createdAt: this._createdAt,
            updatedAt: this._updatedAt
        };
    }

    public with(overrides: {id?: string; name?: string; forge?: ForgeKind; host?: string; revision?: number; createdAt?: string; updatedAt?: string}): CredentialInfo {
        return new CredentialInfo(
            'id' in overrides ? overrides.id! : this._id,
            'name' in overrides ? overrides.name! : this._name,
            'forge' in overrides ? overrides.forge! : this._forge,
            'host' in overrides ? overrides.host! : this._host,
            'revision' in overrides ? overrides.revision! : this._revision,
            'createdAt' in overrides ? overrides.createdAt! : this._createdAt,
            'updatedAt' in overrides ? overrides.updatedAt! : this._updatedAt
        );
    }

    public static fromPlain(obj: {id: string; name: string; forge: ForgeKind; host: string; revision: number; createdAt: string; updatedAt: string}): CredentialInfo {
        return new CredentialInfo(
            obj.id,
            obj.name,
            obj.forge,
            obj.host,
            obj.revision,
            obj.createdAt,
            obj.updatedAt
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
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
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CredentialInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CredentialInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
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
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
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