import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../../BaboonSharedRuntime.js'

export enum ActivityCollectorSort {
    CollectorId = "CollectorId",
    Phase = "Phase",
    Freshness = "Freshness",
    ReceivedAt = "ReceivedAt",
    ArchiveHeads = "ArchiveHeads",
    HeadsWithoutTargetJob = "HeadsWithoutTargetJob",
    CurrentTotal = "CurrentTotal",
    CurrentQueued = "CurrentQueued",
    CurrentRunning = "CurrentRunning",
    CurrentFailed = "CurrentFailed",
    CurrentComplete = "CurrentComplete",
    CurrentActiveRunning = "CurrentActiveRunning",
    CurrentExpiredRunning = "CurrentExpiredRunning",
    CurrentUnleasedRunning = "CurrentUnleasedRunning",
    HistoricalTotal = "HistoricalTotal",
    HistoricalQueued = "HistoricalQueued",
    HistoricalRunning = "HistoricalRunning",
    HistoricalFailed = "HistoricalFailed",
    HistoricalComplete = "HistoricalComplete",
    HistoricalActiveRunning = "HistoricalActiveRunning",
    HistoricalExpiredRunning = "HistoricalExpiredRunning",
    HistoricalUnleasedRunning = "HistoricalUnleasedRunning"
}

export const ActivityCollectorSort_values: ReadonlyArray<ActivityCollectorSort> = [
    ActivityCollectorSort.CollectorId,
    ActivityCollectorSort.Phase,
    ActivityCollectorSort.Freshness,
    ActivityCollectorSort.ReceivedAt,
    ActivityCollectorSort.ArchiveHeads,
    ActivityCollectorSort.HeadsWithoutTargetJob,
    ActivityCollectorSort.CurrentTotal,
    ActivityCollectorSort.CurrentQueued,
    ActivityCollectorSort.CurrentRunning,
    ActivityCollectorSort.CurrentFailed,
    ActivityCollectorSort.CurrentComplete,
    ActivityCollectorSort.CurrentActiveRunning,
    ActivityCollectorSort.CurrentExpiredRunning,
    ActivityCollectorSort.CurrentUnleasedRunning,
    ActivityCollectorSort.HistoricalTotal,
    ActivityCollectorSort.HistoricalQueued,
    ActivityCollectorSort.HistoricalRunning,
    ActivityCollectorSort.HistoricalFailed,
    ActivityCollectorSort.HistoricalComplete,
    ActivityCollectorSort.HistoricalActiveRunning,
    ActivityCollectorSort.HistoricalExpiredRunning,
    ActivityCollectorSort.HistoricalUnleasedRunning
] as const;

export function ActivityCollectorSort_parse(s: string): ActivityCollectorSort {
    const found = ActivityCollectorSort_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ActivityCollectorSort variant: " + s);
    }
    return found;
}

/** @deprecated Version 1.4.0 is deprecated, you should migrate to 1.5.0 */
export class ActivityCollectorSort_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityCollectorSort): unknown {
        if (this !== ActivityCollectorSort_JsonCodec.lazyInstance.value) {
          return ActivityCollectorSort_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityCollectorSort {
        if (this !== ActivityCollectorSort_JsonCodec .lazyInstance.value) {
            return ActivityCollectorSort_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ActivityCollectorSort_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return ActivityCollectorSort_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityCollectorSort_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityCollectorSort'
    public baboonTypeIdentifier() {
        return ActivityCollectorSort_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityCollectorSort_JsonCodec())
    public static get instance(): ActivityCollectorSort_JsonCodec {
        return ActivityCollectorSort_JsonCodec.lazyInstance.value
    }
}