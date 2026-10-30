import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {IndexingSettings, IndexingSettings_JsonCodec} from './IndexingSettings.js'
import {ModelRateBasis, ModelRateBasis_JsonCodec} from './ModelRateBasis.js'
import {ModelUsageSlice, ModelUsageSlice_JsonCodec} from './ModelUsageSlice.js'

export class ModelUsageResult implements BaboonGenerated {
    private readonly _observedAt: string;
    private readonly _processStartedAt: string;
    private readonly _windowStartAt: string;
    private readonly _windowEndAt: string;
    private readonly _coveredMillis: number;
    private readonly _basis: ModelRateBasis;
    private readonly _settings: IndexingSettings;
    private readonly _samples: Array<ModelUsageSlice>;

    constructor(observedAt: string, processStartedAt: string, windowStartAt: string, windowEndAt: string, coveredMillis: number, basis: ModelRateBasis, settings: IndexingSettings, samples: Array<ModelUsageSlice>) {
        this._observedAt = observedAt
        this._processStartedAt = processStartedAt
        this._windowStartAt = windowStartAt
        this._windowEndAt = windowEndAt
        this._coveredMillis = coveredMillis
        this._basis = basis
        this._settings = settings
        this._samples = samples
    }

    public get observedAt(): string {
        return this._observedAt;
    }
    public get processStartedAt(): string {
        return this._processStartedAt;
    }
    public get windowStartAt(): string {
        return this._windowStartAt;
    }
    public get windowEndAt(): string {
        return this._windowEndAt;
    }
    public get coveredMillis(): number {
        return this._coveredMillis;
    }
    public get basis(): ModelRateBasis {
        return this._basis;
    }
    public get settings(): IndexingSettings {
        return this._settings;
    }
    public get samples(): Array<ModelUsageSlice> {
        return this._samples;
    }

    public toJSON(): Record<string, unknown> {
        return {
            observedAt: this._observedAt,
            processStartedAt: this._processStartedAt,
            windowStartAt: this._windowStartAt,
            windowEndAt: this._windowEndAt,
            coveredMillis: this._coveredMillis,
            basis: this._basis,
            settings: this._settings,
            samples: this._samples
        };
    }

    public with(overrides: {observedAt?: string; processStartedAt?: string; windowStartAt?: string; windowEndAt?: string; coveredMillis?: number; basis?: ModelRateBasis; settings?: IndexingSettings; samples?: Array<ModelUsageSlice>}): ModelUsageResult {
        return new ModelUsageResult(
            'observedAt' in overrides ? overrides.observedAt! : this._observedAt,
            'processStartedAt' in overrides ? overrides.processStartedAt! : this._processStartedAt,
            'windowStartAt' in overrides ? overrides.windowStartAt! : this._windowStartAt,
            'windowEndAt' in overrides ? overrides.windowEndAt! : this._windowEndAt,
            'coveredMillis' in overrides ? overrides.coveredMillis! : this._coveredMillis,
            'basis' in overrides ? overrides.basis! : this._basis,
            'settings' in overrides ? overrides.settings! : this._settings,
            'samples' in overrides ? overrides.samples! : this._samples
        );
    }

    public static fromPlain(obj: {observedAt: string; processStartedAt: string; windowStartAt: string; windowEndAt: string; coveredMillis: number; basis: ModelRateBasis; settings: IndexingSettings; samples: Array<ModelUsageSlice>}): ModelUsageResult {
        return new ModelUsageResult(
            obj.observedAt,
            obj.processStartedAt,
            obj.windowStartAt,
            obj.windowEndAt,
            obj.coveredMillis,
            obj.basis,
            obj.settings,
            obj.samples
        );
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return ModelUsageResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ModelUsageResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ModelUsageResult'
    public baboonTypeIdentifier() {
        return ModelUsageResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return ModelUsageResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return ModelUsageResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return ModelUsageResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): ModelUsageResult_JsonCodec {
        return ModelUsageResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.7.0 is deprecated, you should migrate to 1.8.0 */
export class ModelUsageResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ModelUsageResult): unknown {
        if (this !== ModelUsageResult_JsonCodec.lazyInstance.value) {
          return ModelUsageResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "observedAt": value.observedAt,
            "processStartedAt": value.processStartedAt,
            "windowStartAt": value.windowStartAt,
            "windowEndAt": value.windowEndAt,
            "coveredMillis": value.coveredMillis,
            "basis": ModelRateBasis_JsonCodec.instance.encode(BaboonCodecContext.Default, value.basis),
            "settings": IndexingSettings_JsonCodec.instance.encode(BaboonCodecContext.Default, value.settings),
            "samples": Array.from(value.samples).map(item => ModelUsageSlice_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ModelUsageResult {
        if (this !== ModelUsageResult_JsonCodec .lazyInstance.value) {
            return ModelUsageResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ModelUsageResult (
            obj["observedAt"] as string,
            obj["processStartedAt"] as string,
            obj["windowStartAt"] as string,
            obj["windowEndAt"] as string,
            obj["coveredMillis"] as number,
            ModelRateBasis_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["basis"]),
            IndexingSettings_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["settings"]),
            (obj["samples"] as unknown[]).map(item => ModelUsageSlice_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return ModelUsageResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ModelUsageResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ModelUsageResult'
    public baboonTypeIdentifier() {
        return ModelUsageResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ModelUsageResult_JsonCodec())
    public static get instance(): ModelUsageResult_JsonCodec {
        return ModelUsageResult_JsonCodec.lazyInstance.value
    }
}