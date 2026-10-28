import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ActivityJobScope {
    Current = "Current",
    Historical = "Historical",
    All = "All"
}

export const ActivityJobScope_values: ReadonlyArray<ActivityJobScope> = [
    ActivityJobScope.Current,
    ActivityJobScope.Historical,
    ActivityJobScope.All
] as const;

export function ActivityJobScope_parse(s: string): ActivityJobScope {
    const found = ActivityJobScope_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ActivityJobScope variant: " + s);
    }
    return found;
}

export class ActivityJobScope_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobScope): unknown {
        if (this !== ActivityJobScope_JsonCodec.lazyInstance.value) {
          return ActivityJobScope_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobScope {
        if (this !== ActivityJobScope_JsonCodec .lazyInstance.value) {
            return ActivityJobScope_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ActivityJobScope_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return ActivityJobScope_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobScope_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityJobScope'
    public baboonTypeIdentifier() {
        return ActivityJobScope_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobScope_JsonCodec())
    public static get instance(): ActivityJobScope_JsonCodec {
        return ActivityJobScope_JsonCodec.lazyInstance.value
    }
}