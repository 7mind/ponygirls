import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export type ActivityJobWaiting = ActivityJobWaiting_Queued | ActivityJobWaiting_IndexingOff | ActivityJobWaiting_AwaitingReclaim | ActivityJobWaiting_LeaseExpiredAwaitingReclaim | ActivityJobWaiting_LeaseExhaustedPending | ActivityJobWaiting_RunningWithoutLease | ActivityJobWaiting_Held | ActivityJobWaiting_BlockedByOlderRevision | ActivityJobWaiting_AwaitingLargeLane | ActivityJobWaiting_AwaitingLargePermit | ActivityJobWaiting_ProfileNotRun

export const ActivityJobWaiting = {
    BaboonDomainVersion: '1.9.0',
    BaboonDomainIdentifier: 'chronicle.api',
    BaboonTypeIdentifier: 'chronicle.api/:#ActivityJobWaiting',
    BaboonSameInVersions: ["1.9.0"],
    BaboonForwardReadable: { "1.9.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'chronicle.api/:#ActivityJobWaiting',
    jsonCodec(): ActivityJobWaiting_JsonCodec {
        return ActivityJobWaiting_JsonCodec.instance
    }
} as const

export class ActivityJobWaiting_Queued implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#Queued' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): ActivityJobWaiting_Queued {
        return new ActivityJobWaiting_Queued(
            
        );
    }

    public static fromPlain(obj: {}): ActivityJobWaiting_Queued {
        return new ActivityJobWaiting_Queued(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_Queued.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_Queued.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#Queued'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_Queued.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityJobWaiting_Queued.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityJobWaiting_Queued.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityJobWaiting_Queued.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_Queued.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ActivityJobWaiting_Queued_JsonCodec {
        return ActivityJobWaiting_Queued_JsonCodec.instance
    }
}

export class ActivityJobWaiting_Queued_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobWaiting_Queued): unknown {
        if (this !== ActivityJobWaiting_Queued_JsonCodec.lazyInstance.value) {
          return ActivityJobWaiting_Queued_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobWaiting_Queued {
        if (this !== ActivityJobWaiting_Queued_JsonCodec .lazyInstance.value) {
            return ActivityJobWaiting_Queued_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityJobWaiting_Queued (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_Queued_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_Queued_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#Queued'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_Queued_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_Queued_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobWaiting_Queued_JsonCodec())
    public static get instance(): ActivityJobWaiting_Queued_JsonCodec {
        return ActivityJobWaiting_Queued_JsonCodec.lazyInstance.value
    }
}

export class ActivityJobWaiting_IndexingOff implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#IndexingOff' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): ActivityJobWaiting_IndexingOff {
        return new ActivityJobWaiting_IndexingOff(
            
        );
    }

    public static fromPlain(obj: {}): ActivityJobWaiting_IndexingOff {
        return new ActivityJobWaiting_IndexingOff(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_IndexingOff.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_IndexingOff.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#IndexingOff'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_IndexingOff.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityJobWaiting_IndexingOff.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityJobWaiting_IndexingOff.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityJobWaiting_IndexingOff.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_IndexingOff.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ActivityJobWaiting_IndexingOff_JsonCodec {
        return ActivityJobWaiting_IndexingOff_JsonCodec.instance
    }
}

export class ActivityJobWaiting_IndexingOff_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobWaiting_IndexingOff): unknown {
        if (this !== ActivityJobWaiting_IndexingOff_JsonCodec.lazyInstance.value) {
          return ActivityJobWaiting_IndexingOff_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobWaiting_IndexingOff {
        if (this !== ActivityJobWaiting_IndexingOff_JsonCodec .lazyInstance.value) {
            return ActivityJobWaiting_IndexingOff_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityJobWaiting_IndexingOff (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_IndexingOff_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_IndexingOff_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#IndexingOff'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_IndexingOff_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_IndexingOff_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobWaiting_IndexingOff_JsonCodec())
    public static get instance(): ActivityJobWaiting_IndexingOff_JsonCodec {
        return ActivityJobWaiting_IndexingOff_JsonCodec.lazyInstance.value
    }
}

export class ActivityJobWaiting_AwaitingReclaim implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#AwaitingReclaim' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): ActivityJobWaiting_AwaitingReclaim {
        return new ActivityJobWaiting_AwaitingReclaim(
            
        );
    }

    public static fromPlain(obj: {}): ActivityJobWaiting_AwaitingReclaim {
        return new ActivityJobWaiting_AwaitingReclaim(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_AwaitingReclaim.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_AwaitingReclaim.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#AwaitingReclaim'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_AwaitingReclaim.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityJobWaiting_AwaitingReclaim.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityJobWaiting_AwaitingReclaim.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityJobWaiting_AwaitingReclaim.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_AwaitingReclaim.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ActivityJobWaiting_AwaitingReclaim_JsonCodec {
        return ActivityJobWaiting_AwaitingReclaim_JsonCodec.instance
    }
}

export class ActivityJobWaiting_AwaitingReclaim_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobWaiting_AwaitingReclaim): unknown {
        if (this !== ActivityJobWaiting_AwaitingReclaim_JsonCodec.lazyInstance.value) {
          return ActivityJobWaiting_AwaitingReclaim_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobWaiting_AwaitingReclaim {
        if (this !== ActivityJobWaiting_AwaitingReclaim_JsonCodec .lazyInstance.value) {
            return ActivityJobWaiting_AwaitingReclaim_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityJobWaiting_AwaitingReclaim (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_AwaitingReclaim_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_AwaitingReclaim_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#AwaitingReclaim'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_AwaitingReclaim_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_AwaitingReclaim_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobWaiting_AwaitingReclaim_JsonCodec())
    public static get instance(): ActivityJobWaiting_AwaitingReclaim_JsonCodec {
        return ActivityJobWaiting_AwaitingReclaim_JsonCodec.lazyInstance.value
    }
}

export class ActivityJobWaiting_LeaseExpiredAwaitingReclaim implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#LeaseExpiredAwaitingReclaim' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): ActivityJobWaiting_LeaseExpiredAwaitingReclaim {
        return new ActivityJobWaiting_LeaseExpiredAwaitingReclaim(
            
        );
    }

    public static fromPlain(obj: {}): ActivityJobWaiting_LeaseExpiredAwaitingReclaim {
        return new ActivityJobWaiting_LeaseExpiredAwaitingReclaim(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_LeaseExpiredAwaitingReclaim.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_LeaseExpiredAwaitingReclaim.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#LeaseExpiredAwaitingReclaim'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_LeaseExpiredAwaitingReclaim.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityJobWaiting_LeaseExpiredAwaitingReclaim.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityJobWaiting_LeaseExpiredAwaitingReclaim.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityJobWaiting_LeaseExpiredAwaitingReclaim.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_LeaseExpiredAwaitingReclaim.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec {
        return ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec.instance
    }
}

export class ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobWaiting_LeaseExpiredAwaitingReclaim): unknown {
        if (this !== ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec.lazyInstance.value) {
          return ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobWaiting_LeaseExpiredAwaitingReclaim {
        if (this !== ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec .lazyInstance.value) {
            return ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityJobWaiting_LeaseExpiredAwaitingReclaim (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#LeaseExpiredAwaitingReclaim'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec())
    public static get instance(): ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec {
        return ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec.lazyInstance.value
    }
}

export class ActivityJobWaiting_LeaseExhaustedPending implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#LeaseExhaustedPending' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): ActivityJobWaiting_LeaseExhaustedPending {
        return new ActivityJobWaiting_LeaseExhaustedPending(
            
        );
    }

    public static fromPlain(obj: {}): ActivityJobWaiting_LeaseExhaustedPending {
        return new ActivityJobWaiting_LeaseExhaustedPending(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_LeaseExhaustedPending.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_LeaseExhaustedPending.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#LeaseExhaustedPending'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_LeaseExhaustedPending.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityJobWaiting_LeaseExhaustedPending.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityJobWaiting_LeaseExhaustedPending.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityJobWaiting_LeaseExhaustedPending.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_LeaseExhaustedPending.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ActivityJobWaiting_LeaseExhaustedPending_JsonCodec {
        return ActivityJobWaiting_LeaseExhaustedPending_JsonCodec.instance
    }
}

export class ActivityJobWaiting_LeaseExhaustedPending_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobWaiting_LeaseExhaustedPending): unknown {
        if (this !== ActivityJobWaiting_LeaseExhaustedPending_JsonCodec.lazyInstance.value) {
          return ActivityJobWaiting_LeaseExhaustedPending_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobWaiting_LeaseExhaustedPending {
        if (this !== ActivityJobWaiting_LeaseExhaustedPending_JsonCodec .lazyInstance.value) {
            return ActivityJobWaiting_LeaseExhaustedPending_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityJobWaiting_LeaseExhaustedPending (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_LeaseExhaustedPending_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_LeaseExhaustedPending_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#LeaseExhaustedPending'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_LeaseExhaustedPending_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_LeaseExhaustedPending_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobWaiting_LeaseExhaustedPending_JsonCodec())
    public static get instance(): ActivityJobWaiting_LeaseExhaustedPending_JsonCodec {
        return ActivityJobWaiting_LeaseExhaustedPending_JsonCodec.lazyInstance.value
    }
}

export class ActivityJobWaiting_RunningWithoutLease implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#RunningWithoutLease' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): ActivityJobWaiting_RunningWithoutLease {
        return new ActivityJobWaiting_RunningWithoutLease(
            
        );
    }

    public static fromPlain(obj: {}): ActivityJobWaiting_RunningWithoutLease {
        return new ActivityJobWaiting_RunningWithoutLease(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_RunningWithoutLease.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_RunningWithoutLease.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#RunningWithoutLease'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_RunningWithoutLease.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityJobWaiting_RunningWithoutLease.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityJobWaiting_RunningWithoutLease.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityJobWaiting_RunningWithoutLease.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_RunningWithoutLease.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ActivityJobWaiting_RunningWithoutLease_JsonCodec {
        return ActivityJobWaiting_RunningWithoutLease_JsonCodec.instance
    }
}

export class ActivityJobWaiting_RunningWithoutLease_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobWaiting_RunningWithoutLease): unknown {
        if (this !== ActivityJobWaiting_RunningWithoutLease_JsonCodec.lazyInstance.value) {
          return ActivityJobWaiting_RunningWithoutLease_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobWaiting_RunningWithoutLease {
        if (this !== ActivityJobWaiting_RunningWithoutLease_JsonCodec .lazyInstance.value) {
            return ActivityJobWaiting_RunningWithoutLease_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityJobWaiting_RunningWithoutLease (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_RunningWithoutLease_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_RunningWithoutLease_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#RunningWithoutLease'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_RunningWithoutLease_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_RunningWithoutLease_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobWaiting_RunningWithoutLease_JsonCodec())
    public static get instance(): ActivityJobWaiting_RunningWithoutLease_JsonCodec {
        return ActivityJobWaiting_RunningWithoutLease_JsonCodec.lazyInstance.value
    }
}

export class ActivityJobWaiting_Held implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#Held' as const;
    private readonly _nextAttemptAt: string;

    constructor(nextAttemptAt: string) {
        this._nextAttemptAt = nextAttemptAt
    }

    public get nextAttemptAt(): string {
        return this._nextAttemptAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            nextAttemptAt: this._nextAttemptAt
        };
    }

    public with(overrides: {nextAttemptAt?: string}): ActivityJobWaiting_Held {
        return new ActivityJobWaiting_Held(
            'nextAttemptAt' in overrides ? overrides.nextAttemptAt! : this._nextAttemptAt
        );
    }

    public static fromPlain(obj: {nextAttemptAt: string}): ActivityJobWaiting_Held {
        return new ActivityJobWaiting_Held(
            obj.nextAttemptAt
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_Held.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_Held.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#Held'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_Held.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityJobWaiting_Held.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityJobWaiting_Held.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityJobWaiting_Held.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_Held.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ActivityJobWaiting_Held_JsonCodec {
        return ActivityJobWaiting_Held_JsonCodec.instance
    }
}

export class ActivityJobWaiting_Held_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobWaiting_Held): unknown {
        if (this !== ActivityJobWaiting_Held_JsonCodec.lazyInstance.value) {
          return ActivityJobWaiting_Held_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "nextAttemptAt": value.nextAttemptAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobWaiting_Held {
        if (this !== ActivityJobWaiting_Held_JsonCodec .lazyInstance.value) {
            return ActivityJobWaiting_Held_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityJobWaiting_Held (
            obj["nextAttemptAt"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_Held_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_Held_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#Held'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_Held_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_Held_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobWaiting_Held_JsonCodec())
    public static get instance(): ActivityJobWaiting_Held_JsonCodec {
        return ActivityJobWaiting_Held_JsonCodec.lazyInstance.value
    }
}

export class ActivityJobWaiting_BlockedByOlderRevision implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#BlockedByOlderRevision' as const;
    private readonly _revision: number;

    constructor(revision: number) {
        this._revision = revision
    }

    public get revision(): number {
        return this._revision;
    }

    public toJSON(): Record<string, unknown> {
        return {
            revision: this._revision
        };
    }

    public with(overrides: {revision?: number}): ActivityJobWaiting_BlockedByOlderRevision {
        return new ActivityJobWaiting_BlockedByOlderRevision(
            'revision' in overrides ? overrides.revision! : this._revision
        );
    }

    public static fromPlain(obj: {revision: number}): ActivityJobWaiting_BlockedByOlderRevision {
        return new ActivityJobWaiting_BlockedByOlderRevision(
            obj.revision
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_BlockedByOlderRevision.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_BlockedByOlderRevision.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#BlockedByOlderRevision'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_BlockedByOlderRevision.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityJobWaiting_BlockedByOlderRevision.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityJobWaiting_BlockedByOlderRevision.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityJobWaiting_BlockedByOlderRevision.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_BlockedByOlderRevision.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ActivityJobWaiting_BlockedByOlderRevision_JsonCodec {
        return ActivityJobWaiting_BlockedByOlderRevision_JsonCodec.instance
    }
}

export class ActivityJobWaiting_BlockedByOlderRevision_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobWaiting_BlockedByOlderRevision): unknown {
        if (this !== ActivityJobWaiting_BlockedByOlderRevision_JsonCodec.lazyInstance.value) {
          return ActivityJobWaiting_BlockedByOlderRevision_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "revision": value.revision,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobWaiting_BlockedByOlderRevision {
        if (this !== ActivityJobWaiting_BlockedByOlderRevision_JsonCodec .lazyInstance.value) {
            return ActivityJobWaiting_BlockedByOlderRevision_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityJobWaiting_BlockedByOlderRevision (
            obj["revision"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_BlockedByOlderRevision_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_BlockedByOlderRevision_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#BlockedByOlderRevision'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_BlockedByOlderRevision_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_BlockedByOlderRevision_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobWaiting_BlockedByOlderRevision_JsonCodec())
    public static get instance(): ActivityJobWaiting_BlockedByOlderRevision_JsonCodec {
        return ActivityJobWaiting_BlockedByOlderRevision_JsonCodec.lazyInstance.value
    }
}

export class ActivityJobWaiting_AwaitingLargeLane implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#AwaitingLargeLane' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): ActivityJobWaiting_AwaitingLargeLane {
        return new ActivityJobWaiting_AwaitingLargeLane(
            
        );
    }

    public static fromPlain(obj: {}): ActivityJobWaiting_AwaitingLargeLane {
        return new ActivityJobWaiting_AwaitingLargeLane(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_AwaitingLargeLane.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_AwaitingLargeLane.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#AwaitingLargeLane'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_AwaitingLargeLane.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityJobWaiting_AwaitingLargeLane.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityJobWaiting_AwaitingLargeLane.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityJobWaiting_AwaitingLargeLane.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_AwaitingLargeLane.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ActivityJobWaiting_AwaitingLargeLane_JsonCodec {
        return ActivityJobWaiting_AwaitingLargeLane_JsonCodec.instance
    }
}

export class ActivityJobWaiting_AwaitingLargeLane_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobWaiting_AwaitingLargeLane): unknown {
        if (this !== ActivityJobWaiting_AwaitingLargeLane_JsonCodec.lazyInstance.value) {
          return ActivityJobWaiting_AwaitingLargeLane_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobWaiting_AwaitingLargeLane {
        if (this !== ActivityJobWaiting_AwaitingLargeLane_JsonCodec .lazyInstance.value) {
            return ActivityJobWaiting_AwaitingLargeLane_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityJobWaiting_AwaitingLargeLane (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_AwaitingLargeLane_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_AwaitingLargeLane_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#AwaitingLargeLane'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_AwaitingLargeLane_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_AwaitingLargeLane_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobWaiting_AwaitingLargeLane_JsonCodec())
    public static get instance(): ActivityJobWaiting_AwaitingLargeLane_JsonCodec {
        return ActivityJobWaiting_AwaitingLargeLane_JsonCodec.lazyInstance.value
    }
}

export class ActivityJobWaiting_AwaitingLargePermit implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#AwaitingLargePermit' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): ActivityJobWaiting_AwaitingLargePermit {
        return new ActivityJobWaiting_AwaitingLargePermit(
            
        );
    }

    public static fromPlain(obj: {}): ActivityJobWaiting_AwaitingLargePermit {
        return new ActivityJobWaiting_AwaitingLargePermit(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_AwaitingLargePermit.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_AwaitingLargePermit.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#AwaitingLargePermit'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_AwaitingLargePermit.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityJobWaiting_AwaitingLargePermit.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityJobWaiting_AwaitingLargePermit.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityJobWaiting_AwaitingLargePermit.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_AwaitingLargePermit.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ActivityJobWaiting_AwaitingLargePermit_JsonCodec {
        return ActivityJobWaiting_AwaitingLargePermit_JsonCodec.instance
    }
}

export class ActivityJobWaiting_AwaitingLargePermit_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobWaiting_AwaitingLargePermit): unknown {
        if (this !== ActivityJobWaiting_AwaitingLargePermit_JsonCodec.lazyInstance.value) {
          return ActivityJobWaiting_AwaitingLargePermit_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobWaiting_AwaitingLargePermit {
        if (this !== ActivityJobWaiting_AwaitingLargePermit_JsonCodec .lazyInstance.value) {
            return ActivityJobWaiting_AwaitingLargePermit_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityJobWaiting_AwaitingLargePermit (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_AwaitingLargePermit_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_AwaitingLargePermit_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#AwaitingLargePermit'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_AwaitingLargePermit_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_AwaitingLargePermit_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobWaiting_AwaitingLargePermit_JsonCodec())
    public static get instance(): ActivityJobWaiting_AwaitingLargePermit_JsonCodec {
        return ActivityJobWaiting_AwaitingLargePermit_JsonCodec.lazyInstance.value
    }
}

export class ActivityJobWaiting_ProfileNotRun implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#ProfileNotRun' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): ActivityJobWaiting_ProfileNotRun {
        return new ActivityJobWaiting_ProfileNotRun(
            
        );
    }

    public static fromPlain(obj: {}): ActivityJobWaiting_ProfileNotRun {
        return new ActivityJobWaiting_ProfileNotRun(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_ProfileNotRun.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_ProfileNotRun.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#ProfileNotRun'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_ProfileNotRun.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ActivityJobWaiting_ProfileNotRun.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ActivityJobWaiting_ProfileNotRun.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ActivityJobWaiting_ProfileNotRun.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_ProfileNotRun.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ActivityJobWaiting_ProfileNotRun_JsonCodec {
        return ActivityJobWaiting_ProfileNotRun_JsonCodec.instance
    }
}

export class ActivityJobWaiting_ProfileNotRun_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobWaiting_ProfileNotRun): unknown {
        if (this !== ActivityJobWaiting_ProfileNotRun_JsonCodec.lazyInstance.value) {
          return ActivityJobWaiting_ProfileNotRun_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobWaiting_ProfileNotRun {
        if (this !== ActivityJobWaiting_ProfileNotRun_JsonCodec .lazyInstance.value) {
            return ActivityJobWaiting_ProfileNotRun_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityJobWaiting_ProfileNotRun (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_ProfileNotRun_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_ProfileNotRun_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ActivityJobWaiting]#ProfileNotRun'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_ProfileNotRun_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_ProfileNotRun_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobWaiting_ProfileNotRun_JsonCodec())
    public static get instance(): ActivityJobWaiting_ProfileNotRun_JsonCodec {
        return ActivityJobWaiting_ProfileNotRun_JsonCodec.lazyInstance.value
    }
}


export class ActivityJobWaiting_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobWaiting): unknown {
        if (this !== ActivityJobWaiting_JsonCodec.lazyInstance.value) {
          return ActivityJobWaiting_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof ActivityJobWaiting_Queued) {
                return { "Queued": ActivityJobWaiting_Queued_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ActivityJobWaiting_IndexingOff) {
                return { "IndexingOff": ActivityJobWaiting_IndexingOff_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ActivityJobWaiting_AwaitingReclaim) {
                return { "AwaitingReclaim": ActivityJobWaiting_AwaitingReclaim_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ActivityJobWaiting_LeaseExpiredAwaitingReclaim) {
                return { "LeaseExpiredAwaitingReclaim": ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ActivityJobWaiting_LeaseExhaustedPending) {
                return { "LeaseExhaustedPending": ActivityJobWaiting_LeaseExhaustedPending_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ActivityJobWaiting_RunningWithoutLease) {
                return { "RunningWithoutLease": ActivityJobWaiting_RunningWithoutLease_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ActivityJobWaiting_Held) {
                return { "Held": ActivityJobWaiting_Held_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ActivityJobWaiting_BlockedByOlderRevision) {
                return { "BlockedByOlderRevision": ActivityJobWaiting_BlockedByOlderRevision_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ActivityJobWaiting_AwaitingLargeLane) {
                return { "AwaitingLargeLane": ActivityJobWaiting_AwaitingLargeLane_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ActivityJobWaiting_AwaitingLargePermit) {
                return { "AwaitingLargePermit": ActivityJobWaiting_AwaitingLargePermit_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ActivityJobWaiting_ProfileNotRun) {
                return { "ProfileNotRun": ActivityJobWaiting_ProfileNotRun_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobWaiting {
        if (this !== ActivityJobWaiting_JsonCodec .lazyInstance.value) {
            return ActivityJobWaiting_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Queued": return ActivityJobWaiting_Queued_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "IndexingOff": return ActivityJobWaiting_IndexingOff_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "AwaitingReclaim": return ActivityJobWaiting_AwaitingReclaim_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "LeaseExpiredAwaitingReclaim": return ActivityJobWaiting_LeaseExpiredAwaitingReclaim_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "LeaseExhaustedPending": return ActivityJobWaiting_LeaseExhaustedPending_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "RunningWithoutLease": return ActivityJobWaiting_RunningWithoutLease_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Held": return ActivityJobWaiting_Held_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "BlockedByOlderRevision": return ActivityJobWaiting_BlockedByOlderRevision_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "AwaitingLargeLane": return ActivityJobWaiting_AwaitingLargeLane_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "AwaitingLargePermit": return ActivityJobWaiting_AwaitingLargePermit_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ProfileNotRun": return ActivityJobWaiting_ProfileNotRun_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ActivityJobWaiting_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobWaiting_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonTypeIdentifier() {
        return ActivityJobWaiting_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ActivityJobWaiting'
    public baboonAdtTypeIdentifier() {
        return ActivityJobWaiting_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobWaiting_JsonCodec())
    public static get instance(): ActivityJobWaiting_JsonCodec {
        return ActivityJobWaiting_JsonCodec.lazyInstance.value
    }
}