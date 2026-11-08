import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class RiteInfo implements BaboonGeneratedLatest {
    private readonly _repositoryId: string;
    private readonly _id: string;
    private readonly _schedule: string;
    private readonly _promptPath: string;
    private readonly _modelId: string;
    private readonly _enabled: boolean;
    private readonly _revision: number;

    constructor(repositoryId: string, id: string, schedule: string, promptPath: string, modelId: string, enabled: boolean, revision: number) {
        this._repositoryId = repositoryId
        this._id = id
        this._schedule = schedule
        this._promptPath = promptPath
        this._modelId = modelId
        this._enabled = enabled
        this._revision = revision
    }

    public get repositoryId(): string {
        return this._repositoryId;
    }
    public get id(): string {
        return this._id;
    }
    public get schedule(): string {
        return this._schedule;
    }
    public get promptPath(): string {
        return this._promptPath;
    }
    public get modelId(): string {
        return this._modelId;
    }
    public get enabled(): boolean {
        return this._enabled;
    }
    public get revision(): number {
        return this._revision;
    }

    public toJSON(): Record<string, unknown> {
        return {
            repositoryId: this._repositoryId,
            id: this._id,
            schedule: this._schedule,
            promptPath: this._promptPath,
            modelId: this._modelId,
            enabled: this._enabled,
            revision: this._revision
        };
    }

    public with(overrides: {repositoryId?: string; id?: string; schedule?: string; promptPath?: string; modelId?: string; enabled?: boolean; revision?: number}): RiteInfo {
        return new RiteInfo(
            'repositoryId' in overrides ? overrides.repositoryId! : this._repositoryId,
            'id' in overrides ? overrides.id! : this._id,
            'schedule' in overrides ? overrides.schedule! : this._schedule,
            'promptPath' in overrides ? overrides.promptPath! : this._promptPath,
            'modelId' in overrides ? overrides.modelId! : this._modelId,
            'enabled' in overrides ? overrides.enabled! : this._enabled,
            'revision' in overrides ? overrides.revision! : this._revision
        );
    }

    public static fromPlain(obj: {repositoryId: string; id: string; schedule: string; promptPath: string; modelId: string; enabled: boolean; revision: number}): RiteInfo {
        return new RiteInfo(
            obj.repositoryId,
            obj.id,
            obj.schedule,
            obj.promptPath,
            obj.modelId,
            obj.enabled,
            obj.revision
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return RiteInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RiteInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RiteInfo'
    public baboonTypeIdentifier() {
        return RiteInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return RiteInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return RiteInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return RiteInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): RiteInfo_JsonCodec {
        return RiteInfo_JsonCodec.instance
    }
}

export class RiteInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RiteInfo): unknown {
        if (this !== RiteInfo_JsonCodec.lazyInstance.value) {
          return RiteInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "repositoryId": value.repositoryId,
            "id": value.id,
            "schedule": value.schedule,
            "promptPath": value.promptPath,
            "modelId": value.modelId,
            "enabled": value.enabled,
            "revision": value.revision,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RiteInfo {
        if (this !== RiteInfo_JsonCodec .lazyInstance.value) {
            return RiteInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RiteInfo (
            obj["repositoryId"] as string,
            obj["id"] as string,
            obj["schedule"] as string,
            obj["promptPath"] as string,
            obj["modelId"] as string,
            obj["enabled"] as boolean,
            obj["revision"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return RiteInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RiteInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RiteInfo'
    public baboonTypeIdentifier() {
        return RiteInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RiteInfo_JsonCodec())
    public static get instance(): RiteInfo_JsonCodec {
        return RiteInfo_JsonCodec.lazyInstance.value
    }
}