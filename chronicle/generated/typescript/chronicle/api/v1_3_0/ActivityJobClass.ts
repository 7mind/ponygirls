import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../../BaboonSharedRuntime.js'

export enum ActivityJobClass {
    Current = "Current",
    SupersededRevision = "SupersededRevision",
    ObsoleteProfile = "ObsoleteProfile",
    SupersededRevisionAndProfile = "SupersededRevisionAndProfile"
}

export const ActivityJobClass_values: ReadonlyArray<ActivityJobClass> = [
    ActivityJobClass.Current,
    ActivityJobClass.SupersededRevision,
    ActivityJobClass.ObsoleteProfile,
    ActivityJobClass.SupersededRevisionAndProfile
] as const;

export function ActivityJobClass_parse(s: string): ActivityJobClass {
    const found = ActivityJobClass_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ActivityJobClass variant: " + s);
    }
    return found;
}

/** @deprecated Version 1.3.0 is deprecated, you should migrate to 1.5.0 */
export class ActivityJobClass_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobClass): unknown {
        if (this !== ActivityJobClass_JsonCodec.lazyInstance.value) {
          return ActivityJobClass_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobClass {
        if (this !== ActivityJobClass_JsonCodec .lazyInstance.value) {
            return ActivityJobClass_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ActivityJobClass_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return ActivityJobClass_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobClass_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityJobClass'
    public baboonTypeIdentifier() {
        return ActivityJobClass_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobClass_JsonCodec())
    public static get instance(): ActivityJobClass_JsonCodec {
        return ActivityJobClass_JsonCodec.lazyInstance.value
    }
}