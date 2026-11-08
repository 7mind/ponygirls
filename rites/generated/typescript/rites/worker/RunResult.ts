import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {RunOutcome, RunOutcome_JsonCodec} from './RunOutcome.js'

export class RunResult implements BaboonGeneratedLatest {
    private readonly _protocolVersion: string;
    private readonly _runId: string;
    private readonly _outcome: RunOutcome;
    private readonly _failureCode: string | undefined;

    constructor(protocolVersion: string, runId: string, outcome: RunOutcome, failureCode: string | undefined) {
        this._protocolVersion = protocolVersion
        this._runId = runId
        this._outcome = outcome
        this._failureCode = failureCode
    }

    public get protocolVersion(): string {
        return this._protocolVersion;
    }
    public get runId(): string {
        return this._runId;
    }
    public get outcome(): RunOutcome {
        return this._outcome;
    }
    public get failureCode(): string | undefined {
        return this._failureCode;
    }

    public toJSON(): Record<string, unknown> {
        return {
            protocolVersion: this._protocolVersion,
            runId: this._runId,
            outcome: this._outcome,
            failureCode: this._failureCode !== undefined ? this._failureCode : undefined
        };
    }

    public with(overrides: {protocolVersion?: string; runId?: string; outcome?: RunOutcome; failureCode?: string | undefined}): RunResult {
        return new RunResult(
            'protocolVersion' in overrides ? overrides.protocolVersion! : this._protocolVersion,
            'runId' in overrides ? overrides.runId! : this._runId,
            'outcome' in overrides ? overrides.outcome! : this._outcome,
            'failureCode' in overrides ? overrides.failureCode! : this._failureCode
        );
    }

    public static fromPlain(obj: {protocolVersion: string; runId: string; outcome: RunOutcome; failureCode: string | undefined}): RunResult {
        return new RunResult(
            obj.protocolVersion,
            obj.runId,
            obj.outcome,
            obj.failureCode
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RunResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.worker'
    public baboonDomainIdentifier() {
        return RunResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.worker/:#RunResult'
    public baboonTypeIdentifier() {
        return RunResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return RunResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return RunResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return RunResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): RunResult_JsonCodec {
        return RunResult_JsonCodec.instance
    }
}

export class RunResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RunResult): unknown {
        if (this !== RunResult_JsonCodec.lazyInstance.value) {
          return RunResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "protocolVersion": value.protocolVersion,
            "runId": value.runId,
            "outcome": RunOutcome_JsonCodec.instance.encode(BaboonCodecContext.Default, value.outcome),
            "failureCode": value.failureCode === undefined ? null : value.failureCode,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RunResult {
        if (this !== RunResult_JsonCodec .lazyInstance.value) {
            return RunResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RunResult (
            obj["protocolVersion"] as string,
            obj["runId"] as string,
            RunOutcome_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["outcome"]),
            obj["failureCode"] === undefined || obj["failureCode"] === null ? undefined : obj["failureCode"] === undefined || obj["failureCode"] === null ? undefined : obj["failureCode"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RunResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.worker'
    public baboonDomainIdentifier() {
        return RunResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.worker/:#RunResult'
    public baboonTypeIdentifier() {
        return RunResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RunResult_JsonCodec())
    public static get instance(): RunResult_JsonCodec {
        return RunResult_JsonCodec.lazyInstance.value
    }
}