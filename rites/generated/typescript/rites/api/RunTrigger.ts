import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum RunTrigger {
    Schedule = "Schedule",
    Manual = "Manual"
}

export const RunTrigger_values: ReadonlyArray<RunTrigger> = [
    RunTrigger.Schedule,
    RunTrigger.Manual
] as const;

export function RunTrigger_parse(s: string): RunTrigger {
    const found = RunTrigger_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown RunTrigger variant: " + s);
    }
    return found;
}

export class RunTrigger_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RunTrigger): unknown {
        if (this !== RunTrigger_JsonCodec.lazyInstance.value) {
          return RunTrigger_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RunTrigger {
        if (this !== RunTrigger_JsonCodec .lazyInstance.value) {
            return RunTrigger_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return RunTrigger_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return RunTrigger_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RunTrigger_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RunTrigger'
    public baboonTypeIdentifier() {
        return RunTrigger_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RunTrigger_JsonCodec())
    public static get instance(): RunTrigger_JsonCodec {
        return RunTrigger_JsonCodec.lazyInstance.value
    }
}