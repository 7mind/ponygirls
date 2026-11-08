import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class ModelInfo implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _provider: string;
    private readonly _model: string;
    private readonly _thinkingLevel: string;

    constructor(id: string, provider: string, model: string, thinkingLevel: string) {
        this._id = id
        this._provider = provider
        this._model = model
        this._thinkingLevel = thinkingLevel
    }

    public get id(): string {
        return this._id;
    }
    public get provider(): string {
        return this._provider;
    }
    public get model(): string {
        return this._model;
    }
    public get thinkingLevel(): string {
        return this._thinkingLevel;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            provider: this._provider,
            model: this._model,
            thinkingLevel: this._thinkingLevel
        };
    }

    public with(overrides: {id?: string; provider?: string; model?: string; thinkingLevel?: string}): ModelInfo {
        return new ModelInfo(
            'id' in overrides ? overrides.id! : this._id,
            'provider' in overrides ? overrides.provider! : this._provider,
            'model' in overrides ? overrides.model! : this._model,
            'thinkingLevel' in overrides ? overrides.thinkingLevel! : this._thinkingLevel
        );
    }

    public static fromPlain(obj: {id: string; provider: string; model: string; thinkingLevel: string}): ModelInfo {
        return new ModelInfo(
            obj.id,
            obj.provider,
            obj.model,
            obj.thinkingLevel
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ModelInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return ModelInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#ModelInfo'
    public baboonTypeIdentifier() {
        return ModelInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ModelInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ModelInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ModelInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): ModelInfo_JsonCodec {
        return ModelInfo_JsonCodec.instance
    }
}

export class ModelInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ModelInfo): unknown {
        if (this !== ModelInfo_JsonCodec.lazyInstance.value) {
          return ModelInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "provider": value.provider,
            "model": value.model,
            "thinkingLevel": value.thinkingLevel,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ModelInfo {
        if (this !== ModelInfo_JsonCodec .lazyInstance.value) {
            return ModelInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ModelInfo (
            obj["id"] as string,
            obj["provider"] as string,
            obj["model"] as string,
            obj["thinkingLevel"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ModelInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return ModelInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#ModelInfo'
    public baboonTypeIdentifier() {
        return ModelInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ModelInfo_JsonCodec())
    public static get instance(): ModelInfo_JsonCodec {
        return ModelInfo_JsonCodec.lazyInstance.value
    }
}