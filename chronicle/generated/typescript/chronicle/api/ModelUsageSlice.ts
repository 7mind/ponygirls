import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {ModelPurpose, ModelPurpose_JsonCodec} from './ModelPurpose.js'
import {TokenRateWindow, TokenRateWindow_JsonCodec} from './TokenRateWindow.js'

export class ModelUsageSlice implements BaboonGeneratedLatest {
    private readonly _purpose: ModelPurpose;
    private readonly _inFlight: number;
    private readonly _finishedCalls: bigint;
    private readonly _failedCalls: bigint;
    private readonly _cancelledCalls: bigint;
    private readonly _invalidUsageCalls: bigint;
    private readonly _input: TokenRateWindow;
    private readonly _output: TokenRateWindow | undefined;
    private readonly _reasoningSubset: TokenRateWindow | undefined;

    constructor(purpose: ModelPurpose, inFlight: number, finishedCalls: bigint, failedCalls: bigint, cancelledCalls: bigint, invalidUsageCalls: bigint, input: TokenRateWindow, output: TokenRateWindow | undefined, reasoningSubset: TokenRateWindow | undefined) {
        this._purpose = purpose
        this._inFlight = inFlight
        this._finishedCalls = finishedCalls
        this._failedCalls = failedCalls
        this._cancelledCalls = cancelledCalls
        this._invalidUsageCalls = invalidUsageCalls
        this._input = input
        this._output = output
        this._reasoningSubset = reasoningSubset
    }

    public get purpose(): ModelPurpose {
        return this._purpose;
    }
    public get inFlight(): number {
        return this._inFlight;
    }
    public get finishedCalls(): bigint {
        return this._finishedCalls;
    }
    public get failedCalls(): bigint {
        return this._failedCalls;
    }
    public get cancelledCalls(): bigint {
        return this._cancelledCalls;
    }
    public get invalidUsageCalls(): bigint {
        return this._invalidUsageCalls;
    }
    public get input(): TokenRateWindow {
        return this._input;
    }
    public get output(): TokenRateWindow | undefined {
        return this._output;
    }
    public get reasoningSubset(): TokenRateWindow | undefined {
        return this._reasoningSubset;
    }

    public toJSON(): Record<string, unknown> {
        return {
            purpose: this._purpose,
            inFlight: this._inFlight,
            finishedCalls: this._finishedCalls,
            failedCalls: this._failedCalls,
            cancelledCalls: this._cancelledCalls,
            invalidUsageCalls: this._invalidUsageCalls,
            input: this._input,
            output: this._output !== undefined ? this._output : undefined,
            reasoningSubset: this._reasoningSubset !== undefined ? this._reasoningSubset : undefined
        };
    }

    public with(overrides: {purpose?: ModelPurpose; inFlight?: number; finishedCalls?: bigint; failedCalls?: bigint; cancelledCalls?: bigint; invalidUsageCalls?: bigint; input?: TokenRateWindow; output?: TokenRateWindow | undefined; reasoningSubset?: TokenRateWindow | undefined}): ModelUsageSlice {
        return new ModelUsageSlice(
            'purpose' in overrides ? overrides.purpose! : this._purpose,
            'inFlight' in overrides ? overrides.inFlight! : this._inFlight,
            'finishedCalls' in overrides ? overrides.finishedCalls! : this._finishedCalls,
            'failedCalls' in overrides ? overrides.failedCalls! : this._failedCalls,
            'cancelledCalls' in overrides ? overrides.cancelledCalls! : this._cancelledCalls,
            'invalidUsageCalls' in overrides ? overrides.invalidUsageCalls! : this._invalidUsageCalls,
            'input' in overrides ? overrides.input! : this._input,
            'output' in overrides ? overrides.output! : this._output,
            'reasoningSubset' in overrides ? overrides.reasoningSubset! : this._reasoningSubset
        );
    }

    public static fromPlain(obj: {purpose: ModelPurpose; inFlight: number; finishedCalls: bigint; failedCalls: bigint; cancelledCalls: bigint; invalidUsageCalls: bigint; input: TokenRateWindow; output: TokenRateWindow | undefined; reasoningSubset: TokenRateWindow | undefined}): ModelUsageSlice {
        return new ModelUsageSlice(
            obj.purpose,
            obj.inFlight,
            obj.finishedCalls,
            obj.failedCalls,
            obj.cancelledCalls,
            obj.invalidUsageCalls,
            obj.input,
            obj.output,
            obj.reasoningSubset
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return ModelUsageSlice.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ModelUsageSlice.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ModelUsageSlice'
    public baboonTypeIdentifier() {
        return ModelUsageSlice.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0"]
    public baboonSameInVersions() {
        return ModelUsageSlice.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical" }
    public baboonForwardReadable() {
        return ModelUsageSlice.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return ModelUsageSlice.BaboonMinReaderVersions
    }
    public static jsonCodec(): ModelUsageSlice_JsonCodec {
        return ModelUsageSlice_JsonCodec.instance
    }
}

export class ModelUsageSlice_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ModelUsageSlice): unknown {
        if (this !== ModelUsageSlice_JsonCodec.lazyInstance.value) {
          return ModelUsageSlice_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "purpose": ModelPurpose_JsonCodec.instance.encode(BaboonCodecContext.Default, value.purpose),
            "inFlight": value.inFlight,
            "finishedCalls": value.finishedCalls.toString(),
            "failedCalls": value.failedCalls.toString(),
            "cancelledCalls": value.cancelledCalls.toString(),
            "invalidUsageCalls": value.invalidUsageCalls.toString(),
            "input": TokenRateWindow_JsonCodec.instance.encode(BaboonCodecContext.Default, value.input),
            "output": value.output === undefined ? null : TokenRateWindow_JsonCodec.instance.encode(BaboonCodecContext.Default, value.output),
            "reasoningSubset": value.reasoningSubset === undefined ? null : TokenRateWindow_JsonCodec.instance.encode(BaboonCodecContext.Default, value.reasoningSubset),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ModelUsageSlice {
        if (this !== ModelUsageSlice_JsonCodec .lazyInstance.value) {
            return ModelUsageSlice_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ModelUsageSlice (
            ModelPurpose_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["purpose"]),
            obj["inFlight"] as number,
            BaboonInt64.read(obj["finishedCalls"], "i64/u64"),
            BaboonInt64.read(obj["failedCalls"], "i64/u64"),
            BaboonInt64.read(obj["cancelledCalls"], "i64/u64"),
            BaboonInt64.read(obj["invalidUsageCalls"], "i64/u64"),
            TokenRateWindow_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["input"]),
            obj["output"] === undefined || obj["output"] === null ? undefined : obj["output"] === undefined || obj["output"] === null ? undefined : TokenRateWindow_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["output"]),
            obj["reasoningSubset"] === undefined || obj["reasoningSubset"] === null ? undefined : obj["reasoningSubset"] === undefined || obj["reasoningSubset"] === null ? undefined : TokenRateWindow_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["reasoningSubset"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return ModelUsageSlice_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ModelUsageSlice_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ModelUsageSlice'
    public baboonTypeIdentifier() {
        return ModelUsageSlice_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ModelUsageSlice_JsonCodec())
    public static get instance(): ModelUsageSlice_JsonCodec {
        return ModelUsageSlice_JsonCodec.lazyInstance.value
    }
}