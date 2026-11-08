import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ForgeKind, ForgeKind_JsonCodec} from './ForgeKind.js'
import {GrantInfo, GrantInfo_JsonCodec} from './GrantInfo.js'

export class RepositoryInfo implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _owner: string;
    private readonly _forge: ForgeKind;
    private readonly _host: string;
    private readonly _project: string;
    private readonly _baseBranch: string;
    private readonly _credentialId: string;
    private readonly _revision: number;
    private readonly _grants: Array<GrantInfo>;

    constructor(id: string, owner: string, forge: ForgeKind, host: string, project: string, baseBranch: string, credentialId: string, revision: number, grants: Array<GrantInfo>) {
        this._id = id
        this._owner = owner
        this._forge = forge
        this._host = host
        this._project = project
        this._baseBranch = baseBranch
        this._credentialId = credentialId
        this._revision = revision
        this._grants = grants
    }

    public get id(): string {
        return this._id;
    }
    public get owner(): string {
        return this._owner;
    }
    public get forge(): ForgeKind {
        return this._forge;
    }
    public get host(): string {
        return this._host;
    }
    public get project(): string {
        return this._project;
    }
    public get baseBranch(): string {
        return this._baseBranch;
    }
    public get credentialId(): string {
        return this._credentialId;
    }
    public get revision(): number {
        return this._revision;
    }
    public get grants(): Array<GrantInfo> {
        return this._grants;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            owner: this._owner,
            forge: this._forge,
            host: this._host,
            project: this._project,
            baseBranch: this._baseBranch,
            credentialId: this._credentialId,
            revision: this._revision,
            grants: this._grants
        };
    }

    public with(overrides: {id?: string; owner?: string; forge?: ForgeKind; host?: string; project?: string; baseBranch?: string; credentialId?: string; revision?: number; grants?: Array<GrantInfo>}): RepositoryInfo {
        return new RepositoryInfo(
            'id' in overrides ? overrides.id! : this._id,
            'owner' in overrides ? overrides.owner! : this._owner,
            'forge' in overrides ? overrides.forge! : this._forge,
            'host' in overrides ? overrides.host! : this._host,
            'project' in overrides ? overrides.project! : this._project,
            'baseBranch' in overrides ? overrides.baseBranch! : this._baseBranch,
            'credentialId' in overrides ? overrides.credentialId! : this._credentialId,
            'revision' in overrides ? overrides.revision! : this._revision,
            'grants' in overrides ? overrides.grants! : this._grants
        );
    }

    public static fromPlain(obj: {id: string; owner: string; forge: ForgeKind; host: string; project: string; baseBranch: string; credentialId: string; revision: number; grants: Array<GrantInfo>}): RepositoryInfo {
        return new RepositoryInfo(
            obj.id,
            obj.owner,
            obj.forge,
            obj.host,
            obj.project,
            obj.baseBranch,
            obj.credentialId,
            obj.revision,
            obj.grants
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RepositoryInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RepositoryInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RepositoryInfo'
    public baboonTypeIdentifier() {
        return RepositoryInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RepositoryInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RepositoryInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RepositoryInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): RepositoryInfo_JsonCodec {
        return RepositoryInfo_JsonCodec.instance
    }
}

export class RepositoryInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RepositoryInfo): unknown {
        if (this !== RepositoryInfo_JsonCodec.lazyInstance.value) {
          return RepositoryInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "owner": value.owner,
            "forge": ForgeKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.forge),
            "host": value.host,
            "project": value.project,
            "baseBranch": value.baseBranch,
            "credentialId": value.credentialId,
            "revision": value.revision,
            "grants": Array.from(value.grants).map(item => GrantInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RepositoryInfo {
        if (this !== RepositoryInfo_JsonCodec .lazyInstance.value) {
            return RepositoryInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RepositoryInfo (
            obj["id"] as string,
            obj["owner"] as string,
            ForgeKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["forge"]),
            obj["host"] as string,
            obj["project"] as string,
            obj["baseBranch"] as string,
            obj["credentialId"] as string,
            obj["revision"] as number,
            (obj["grants"] as unknown[]).map(item => GrantInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RepositoryInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RepositoryInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RepositoryInfo'
    public baboonTypeIdentifier() {
        return RepositoryInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RepositoryInfo_JsonCodec())
    public static get instance(): RepositoryInfo_JsonCodec {
        return RepositoryInfo_JsonCodec.lazyInstance.value
    }
}