import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../../BaboonSharedRuntime.js'

export enum ActivityJobSort {
    LastTimestamp = "LastTimestamp",
    Title = "Title",
    Collector = "Collector",
    State = "State",
    Revision = "Revision",
    Profile = "Profile",
    Attempts = "Attempts",
    CompletedWindows = "CompletedWindows",
    TotalWindows = "TotalWindows",
    LeaseExpiresAt = "LeaseExpiresAt",
    LeaseState = "LeaseState",
    Reason = "Reason",
    Classification = "Classification",
    JobId = "JobId",
    SessionId = "SessionId"
}

export const ActivityJobSort_values: ReadonlyArray<ActivityJobSort> = [
    ActivityJobSort.LastTimestamp,
    ActivityJobSort.Title,
    ActivityJobSort.Collector,
    ActivityJobSort.State,
    ActivityJobSort.Revision,
    ActivityJobSort.Profile,
    ActivityJobSort.Attempts,
    ActivityJobSort.CompletedWindows,
    ActivityJobSort.TotalWindows,
    ActivityJobSort.LeaseExpiresAt,
    ActivityJobSort.LeaseState,
    ActivityJobSort.Reason,
    ActivityJobSort.Classification,
    ActivityJobSort.JobId,
    ActivityJobSort.SessionId
] as const;

export function ActivityJobSort_parse(s: string): ActivityJobSort {
    const found = ActivityJobSort_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ActivityJobSort variant: " + s);
    }
    return found;
}

/** @deprecated Version 1.3.0 is deprecated, you should migrate to 1.4.0 */
export class ActivityJobSort_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobSort): unknown {
        if (this !== ActivityJobSort_JsonCodec.lazyInstance.value) {
          return ActivityJobSort_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobSort {
        if (this !== ActivityJobSort_JsonCodec .lazyInstance.value) {
            return ActivityJobSort_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ActivityJobSort_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return ActivityJobSort_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobSort_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityJobSort'
    public baboonTypeIdentifier() {
        return ActivityJobSort_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobSort_JsonCodec())
    public static get instance(): ActivityJobSort_JsonCodec {
        return ActivityJobSort_JsonCodec.lazyInstance.value
    }
}