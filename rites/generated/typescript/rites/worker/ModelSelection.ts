import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class ModelSelection implements BaboonGeneratedLatest {
    private readonly _provider: string;
    private readonly _model: string;
    private readonly _thinkingLevel: string;

    constructor(provider: string, model: string, thinkingLevel: string) {
        this._provider = provider
        this._model = model
        this._thinkingLevel = thinkingLevel
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
            provider: this._provider,
            model: this._model,
            thinkingLevel: this._thinkingLevel
        };
    }

    public with(overrides: {provider?: string; model?: string; thinkingLevel?: string}): ModelSelection {
        return new ModelSelection(
            'provider' in overrides ? overrides.provider! : this._provider,
            'model' in overrides ? overrides.model! : this._model,
            'thinkingLevel' in overrides ? overrides.thinkingLevel! : this._thinkingLevel
        );
    }

    public static fromPlain(obj: {provider: string; model: string; thinkingLevel: string}): ModelSelection {
        return new ModelSelection(
            obj.provider,
            obj.model,
            obj.thinkingLevel
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ModelSelection.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.worker'
    public baboonDomainIdentifier() {
        return ModelSelection.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.worker/:#ModelSelection'
    public baboonTypeIdentifier() {
        return ModelSelection.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ModelSelection.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ModelSelection.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ModelSelection.BaboonMinReaderVersions
    }
    public static jsonCodec(): ModelSelection_JsonCodec {
        return ModelSelection_JsonCodec.instance
    }
}

export class ModelSelection_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ModelSelection): unknown {
        if (this !== ModelSelection_JsonCodec.lazyInstance.value) {
          return ModelSelection_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "provider": value.provider,
            "model": value.model,
            "thinkingLevel": value.thinkingLevel,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ModelSelection {
        if (this !== ModelSelection_JsonCodec .lazyInstance.value) {
            return ModelSelection_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ModelSelection (
            obj["provider"] as string,
            obj["model"] as string,
            obj["thinkingLevel"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ModelSelection_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.worker'
    public baboonDomainIdentifier() {
        return ModelSelection_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.worker/:#ModelSelection'
    public baboonTypeIdentifier() {
        return ModelSelection_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ModelSelection_JsonCodec())
    public static get instance(): ModelSelection_JsonCodec {
        return ModelSelection_JsonCodec.lazyInstance.value
    }
}