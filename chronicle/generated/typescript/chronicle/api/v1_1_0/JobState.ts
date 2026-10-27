import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../../BaboonSharedRuntime.js'

export enum JobState {
    Queued = "Queued",
    Running = "Running",
    Failed = "Failed",
    Complete = "Complete"
}

export const JobState_values: ReadonlyArray<JobState> = [
    JobState.Queued,
    JobState.Running,
    JobState.Failed,
    JobState.Complete
] as const;

export function JobState_parse(s: string): JobState {
    const found = JobState_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown JobState variant: " + s);
    }
    return found;
}

/** @deprecated Version 1.1.0 is deprecated, you should migrate to 1.5.0 */
export class JobState_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: JobState): unknown {
        if (this !== JobState_JsonCodec.lazyInstance.value) {
          return JobState_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): JobState {
        if (this !== JobState_JsonCodec .lazyInstance.value) {
            return JobState_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return JobState_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.1.0'
    public baboonDomainVersion() {
        return JobState_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return JobState_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#JobState'
    public baboonTypeIdentifier() {
        return JobState_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new JobState_JsonCodec())
    public static get instance(): JobState_JsonCodec {
        return JobState_JsonCodec.lazyInstance.value
    }
}