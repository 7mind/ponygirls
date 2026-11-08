import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum RunOutcome {
    Completed = "Completed",
    Failed = "Failed",
    Cancelled = "Cancelled"
}

export const RunOutcome_values: ReadonlyArray<RunOutcome> = [
    RunOutcome.Completed,
    RunOutcome.Failed,
    RunOutcome.Cancelled
] as const;

export function RunOutcome_parse(s: string): RunOutcome {
    const found = RunOutcome_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown RunOutcome variant: " + s);
    }
    return found;
}

export class RunOutcome_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RunOutcome): unknown {
        if (this !== RunOutcome_JsonCodec.lazyInstance.value) {
          return RunOutcome_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RunOutcome {
        if (this !== RunOutcome_JsonCodec .lazyInstance.value) {
            return RunOutcome_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return RunOutcome_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RunOutcome_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.worker'
    public baboonDomainIdentifier() {
        return RunOutcome_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.worker/:#RunOutcome'
    public baboonTypeIdentifier() {
        return RunOutcome_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RunOutcome_JsonCodec())
    public static get instance(): RunOutcome_JsonCodec {
        return RunOutcome_JsonCodec.lazyInstance.value
    }
}