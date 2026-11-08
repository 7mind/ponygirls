import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ModelSelection, ModelSelection_JsonCodec} from './ModelSelection.js'

export class RunRequest implements BaboonGeneratedLatest {
    private readonly _protocolVersion: string;
    private readonly _runId: string;
    private readonly _prompt: string;
    private readonly _model: ModelSelection;

    constructor(protocolVersion: string, runId: string, prompt: string, model: ModelSelection) {
        this._protocolVersion = protocolVersion
        this._runId = runId
        this._prompt = prompt
        this._model = model
    }

    public get protocolVersion(): string {
        return this._protocolVersion;
    }
    public get runId(): string {
        return this._runId;
    }
    public get prompt(): string {
        return this._prompt;
    }
    public get model(): ModelSelection {
        return this._model;
    }

    public toJSON(): Record<string, unknown> {
        return {
            protocolVersion: this._protocolVersion,
            runId: this._runId,
            prompt: this._prompt,
            model: this._model
        };
    }

    public with(overrides: {protocolVersion?: string; runId?: string; prompt?: string; model?: ModelSelection}): RunRequest {
        return new RunRequest(
            'protocolVersion' in overrides ? overrides.protocolVersion! : this._protocolVersion,
            'runId' in overrides ? overrides.runId! : this._runId,
            'prompt' in overrides ? overrides.prompt! : this._prompt,
            'model' in overrides ? overrides.model! : this._model
        );
    }

    public static fromPlain(obj: {protocolVersion: string; runId: string; prompt: string; model: ModelSelection}): RunRequest {
        return new RunRequest(
            obj.protocolVersion,
            obj.runId,
            obj.prompt,
            obj.model
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RunRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.worker'
    public baboonDomainIdentifier() {
        return RunRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.worker/:#RunRequest'
    public baboonTypeIdentifier() {
        return RunRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RunRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RunRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RunRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): RunRequest_JsonCodec {
        return RunRequest_JsonCodec.instance
    }
}

export class RunRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RunRequest): unknown {
        if (this !== RunRequest_JsonCodec.lazyInstance.value) {
          return RunRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "protocolVersion": value.protocolVersion,
            "runId": value.runId,
            "prompt": value.prompt,
            "model": ModelSelection_JsonCodec.instance.encode(BaboonCodecContext.Default, value.model),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RunRequest {
        if (this !== RunRequest_JsonCodec .lazyInstance.value) {
            return RunRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RunRequest (
            obj["protocolVersion"] as string,
            obj["runId"] as string,
            obj["prompt"] as string,
            ModelSelection_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["model"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RunRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.worker'
    public baboonDomainIdentifier() {
        return RunRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.worker/:#RunRequest'
    public baboonTypeIdentifier() {
        return RunRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RunRequest_JsonCodec())
    public static get instance(): RunRequest_JsonCodec {
        return RunRequest_JsonCodec.lazyInstance.value
    }
}