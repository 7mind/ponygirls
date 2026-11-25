import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ActivityClaimOrder {
    SourceId = "SourceId",
    Waiting = "Waiting"
}

export const ActivityClaimOrder_values: ReadonlyArray<ActivityClaimOrder> = [
    ActivityClaimOrder.SourceId,
    ActivityClaimOrder.Waiting
] as const;

export function ActivityClaimOrder_parse(s: string): ActivityClaimOrder {
    const found = ActivityClaimOrder_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ActivityClaimOrder variant: " + s);
    }
    return found;
}

export class ActivityClaimOrder_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityClaimOrder): unknown {
        if (this !== ActivityClaimOrder_JsonCodec.lazyInstance.value) {
          return ActivityClaimOrder_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityClaimOrder {
        if (this !== ActivityClaimOrder_JsonCodec .lazyInstance.value) {
            return ActivityClaimOrder_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ActivityClaimOrder_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityClaimOrder_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityClaimOrder_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityClaimOrder'
    public baboonTypeIdentifier() {
        return ActivityClaimOrder_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityClaimOrder_JsonCodec())
    public static get instance(): ActivityClaimOrder_JsonCodec {
        return ActivityClaimOrder_JsonCodec.lazyInstance.value
    }
}