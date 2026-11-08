import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ForgeKind, ForgeKind_JsonCodec} from './ForgeKind.js'

export class SaveRepositoryRequest implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _forge: ForgeKind;
    private readonly _host: string;
    private readonly _project: string;
    private readonly _baseBranch: string;
    private readonly _credentialId: string;
    private readonly _expectedRevision: number;

    constructor(id: string, forge: ForgeKind, host: string, project: string, baseBranch: string, credentialId: string, expectedRevision: number) {
        this._id = id
        this._forge = forge
        this._host = host
        this._project = project
        this._baseBranch = baseBranch
        this._credentialId = credentialId
        this._expectedRevision = expectedRevision
    }

    public get id(): string {
        return this._id;
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
    public get expectedRevision(): number {
        return this._expectedRevision;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            forge: this._forge,
            host: this._host,
            project: this._project,
            baseBranch: this._baseBranch,
            credentialId: this._credentialId,
            expectedRevision: this._expectedRevision
        };
    }

    public with(overrides: {id?: string; forge?: ForgeKind; host?: string; project?: string; baseBranch?: string; credentialId?: string; expectedRevision?: number}): SaveRepositoryRequest {
        return new SaveRepositoryRequest(
            'id' in overrides ? overrides.id! : this._id,
            'forge' in overrides ? overrides.forge! : this._forge,
            'host' in overrides ? overrides.host! : this._host,
            'project' in overrides ? overrides.project! : this._project,
            'baseBranch' in overrides ? overrides.baseBranch! : this._baseBranch,
            'credentialId' in overrides ? overrides.credentialId! : this._credentialId,
            'expectedRevision' in overrides ? overrides.expectedRevision! : this._expectedRevision
        );
    }

    public static fromPlain(obj: {id: string; forge: ForgeKind; host: string; project: string; baseBranch: string; credentialId: string; expectedRevision: number}): SaveRepositoryRequest {
        return new SaveRepositoryRequest(
            obj.id,
            obj.forge,
            obj.host,
            obj.project,
            obj.baseBranch,
            obj.credentialId,
            obj.expectedRevision
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SaveRepositoryRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return SaveRepositoryRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#SaveRepositoryRequest'
    public baboonTypeIdentifier() {
        return SaveRepositoryRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return SaveRepositoryRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return SaveRepositoryRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return SaveRepositoryRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): SaveRepositoryRequest_JsonCodec {
        return SaveRepositoryRequest_JsonCodec.instance
    }
}

export class SaveRepositoryRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SaveRepositoryRequest): unknown {
        if (this !== SaveRepositoryRequest_JsonCodec.lazyInstance.value) {
          return SaveRepositoryRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "forge": ForgeKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.forge),
            "host": value.host,
            "project": value.project,
            "baseBranch": value.baseBranch,
            "credentialId": value.credentialId,
            "expectedRevision": value.expectedRevision,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SaveRepositoryRequest {
        if (this !== SaveRepositoryRequest_JsonCodec .lazyInstance.value) {
            return SaveRepositoryRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SaveRepositoryRequest (
            obj["id"] as string,
            ForgeKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["forge"]),
            obj["host"] as string,
            obj["project"] as string,
            obj["baseBranch"] as string,
            obj["credentialId"] as string,
            obj["expectedRevision"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SaveRepositoryRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return SaveRepositoryRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#SaveRepositoryRequest'
    public baboonTypeIdentifier() {
        return SaveRepositoryRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SaveRepositoryRequest_JsonCodec())
    public static get instance(): SaveRepositoryRequest_JsonCodec {
        return SaveRepositoryRequest_JsonCodec.lazyInstance.value
    }
}