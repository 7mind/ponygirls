import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ActivityClaimOrderSort {
    WaitingSince = "WaitingSince",
    JobClass = "JobClass",
    WaitingReason = "WaitingReason"
}

export const ActivityClaimOrderSort_values: ReadonlyArray<ActivityClaimOrderSort> = [
    ActivityClaimOrderSort.WaitingSince,
    ActivityClaimOrderSort.JobClass,
    ActivityClaimOrderSort.WaitingReason
] as const;

export function ActivityClaimOrderSort_parse(s: string): ActivityClaimOrderSort {
    const found = ActivityClaimOrderSort_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ActivityClaimOrderSort variant: " + s);
    }
    return found;
}

export class ActivityClaimOrderSort_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityClaimOrderSort): unknown {
        if (this !== ActivityClaimOrderSort_JsonCodec.lazyInstance.value) {
          return ActivityClaimOrderSort_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityClaimOrderSort {
        if (this !== ActivityClaimOrderSort_JsonCodec .lazyInstance.value) {
            return ActivityClaimOrderSort_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ActivityClaimOrderSort_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityClaimOrderSort_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityClaimOrderSort_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityClaimOrderSort'
    public baboonTypeIdentifier() {
        return ActivityClaimOrderSort_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityClaimOrderSort_JsonCodec())
    public static get instance(): ActivityClaimOrderSort_JsonCodec {
        return ActivityClaimOrderSort_JsonCodec.lazyInstance.value
    }
}