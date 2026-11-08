import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {RunInfo, RunInfo_JsonCodec} from './RunInfo.js'

export class RunResult implements BaboonGeneratedLatest {
    private readonly _run: RunInfo;

    constructor(run: RunInfo) {
        this._run = run
    }

    public get run(): RunInfo {
        return this._run;
    }

    public toJSON(): Record<string, unknown> {
        return {
            run: this._run
        };
    }

    public with(overrides: {run?: RunInfo}): RunResult {
        return new RunResult(
            'run' in overrides ? overrides.run! : this._run
        );
    }

    public static fromPlain(obj: {run: RunInfo}): RunResult {
        return new RunResult(
            obj.run
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RunResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RunResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RunResult'
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
            "run": RunInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.run),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RunResult {
        if (this !== RunResult_JsonCodec .lazyInstance.value) {
            return RunResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RunResult (
            RunInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["run"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RunResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RunResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RunResult'
    public baboonTypeIdentifier() {
        return RunResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RunResult_JsonCodec())
    public static get instance(): RunResult_JsonCodec {
        return RunResult_JsonCodec.lazyInstance.value
    }
}