import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum RunState {
    Queued = "Queued",
    Running = "Running",
    NoChange = "NoChange",
    Published = "Published",
    Failed = "Failed",
    PublicationUncertain = "PublicationUncertain",
    SupersessionPending = "SupersessionPending",
    Cancelled = "Cancelled"
}

export const RunState_values: ReadonlyArray<RunState> = [
    RunState.Queued,
    RunState.Running,
    RunState.NoChange,
    RunState.Published,
    RunState.Failed,
    RunState.PublicationUncertain,
    RunState.SupersessionPending,
    RunState.Cancelled
] as const;

export function RunState_parse(s: string): RunState {
    const found = RunState_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown RunState variant: " + s);
    }
    return found;
}

export class RunState_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RunState): unknown {
        if (this !== RunState_JsonCodec.lazyInstance.value) {
          return RunState_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RunState {
        if (this !== RunState_JsonCodec .lazyInstance.value) {
            return RunState_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return RunState_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return RunState_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RunState_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RunState'
    public baboonTypeIdentifier() {
        return RunState_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RunState_JsonCodec())
    public static get instance(): RunState_JsonCodec {
        return RunState_JsonCodec.lazyInstance.value
    }
}