import {type BaboonAdtMemberMeta, type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {ActivityJobScope, ActivityJobScope_JsonCodec} from './ActivityJobScope.js'

export type ExpressionHintTarget = ExpressionHintTarget_Archive | ExpressionHintTarget_ActivityCollectors | ExpressionHintTarget_ActivityJobs

export const ExpressionHintTarget = {
    BaboonDomainVersion: '1.6.0',
    BaboonDomainIdentifier: 'chronicle.api',
    BaboonTypeIdentifier: 'chronicle.api/:#ExpressionHintTarget',
    BaboonSameInVersions: ["1.4.0", "1.5.0", "1.6.0", "1.7.0"],
    BaboonForwardReadable: { "1.6.0": "identical", "1.7.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'chronicle.api/:#ExpressionHintTarget',
    jsonCodec(): ExpressionHintTarget_JsonCodec {
        return ExpressionHintTarget_JsonCodec.instance
    }
} as const

export class ExpressionHintTarget_Archive implements BaboonAdtMemberMeta, BaboonGenerated {
    public readonly $type = 'chronicle.api/[chronicle.api/:#ExpressionHintTarget]#Archive' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): ExpressionHintTarget_Archive {
        return new ExpressionHintTarget_Archive(
            
        );
    }

    public static fromPlain(obj: {}): ExpressionHintTarget_Archive {
        return new ExpressionHintTarget_Archive(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return ExpressionHintTarget_Archive.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ExpressionHintTarget_Archive.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ExpressionHintTarget]#Archive'
    public baboonTypeIdentifier() {
        return ExpressionHintTarget_Archive.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return ExpressionHintTarget_Archive.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return ExpressionHintTarget_Archive.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return ExpressionHintTarget_Archive.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ExpressionHintTarget'
    public baboonAdtTypeIdentifier() {
        return ExpressionHintTarget_Archive.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ExpressionHintTarget_Archive_JsonCodec {
        return ExpressionHintTarget_Archive_JsonCodec.instance
    }
}

/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.7.0 */
export class ExpressionHintTarget_Archive_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ExpressionHintTarget_Archive): unknown {
        if (this !== ExpressionHintTarget_Archive_JsonCodec.lazyInstance.value) {
          return ExpressionHintTarget_Archive_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ExpressionHintTarget_Archive {
        if (this !== ExpressionHintTarget_Archive_JsonCodec .lazyInstance.value) {
            return ExpressionHintTarget_Archive_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ExpressionHintTarget_Archive (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return ExpressionHintTarget_Archive_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ExpressionHintTarget_Archive_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ExpressionHintTarget]#Archive'
    public baboonTypeIdentifier() {
        return ExpressionHintTarget_Archive_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ExpressionHintTarget'
    public baboonAdtTypeIdentifier() {
        return ExpressionHintTarget_Archive_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ExpressionHintTarget_Archive_JsonCodec())
    public static get instance(): ExpressionHintTarget_Archive_JsonCodec {
        return ExpressionHintTarget_Archive_JsonCodec.lazyInstance.value
    }
}

export class ExpressionHintTarget_ActivityCollectors implements BaboonAdtMemberMeta, BaboonGenerated {
    public readonly $type = 'chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityCollectors' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): ExpressionHintTarget_ActivityCollectors {
        return new ExpressionHintTarget_ActivityCollectors(
            
        );
    }

    public static fromPlain(obj: {}): ExpressionHintTarget_ActivityCollectors {
        return new ExpressionHintTarget_ActivityCollectors(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return ExpressionHintTarget_ActivityCollectors.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ExpressionHintTarget_ActivityCollectors.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityCollectors'
    public baboonTypeIdentifier() {
        return ExpressionHintTarget_ActivityCollectors.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return ExpressionHintTarget_ActivityCollectors.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return ExpressionHintTarget_ActivityCollectors.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return ExpressionHintTarget_ActivityCollectors.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ExpressionHintTarget'
    public baboonAdtTypeIdentifier() {
        return ExpressionHintTarget_ActivityCollectors.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ExpressionHintTarget_ActivityCollectors_JsonCodec {
        return ExpressionHintTarget_ActivityCollectors_JsonCodec.instance
    }
}

/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.7.0 */
export class ExpressionHintTarget_ActivityCollectors_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ExpressionHintTarget_ActivityCollectors): unknown {
        if (this !== ExpressionHintTarget_ActivityCollectors_JsonCodec.lazyInstance.value) {
          return ExpressionHintTarget_ActivityCollectors_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ExpressionHintTarget_ActivityCollectors {
        if (this !== ExpressionHintTarget_ActivityCollectors_JsonCodec .lazyInstance.value) {
            return ExpressionHintTarget_ActivityCollectors_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ExpressionHintTarget_ActivityCollectors (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return ExpressionHintTarget_ActivityCollectors_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ExpressionHintTarget_ActivityCollectors_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityCollectors'
    public baboonTypeIdentifier() {
        return ExpressionHintTarget_ActivityCollectors_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ExpressionHintTarget'
    public baboonAdtTypeIdentifier() {
        return ExpressionHintTarget_ActivityCollectors_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ExpressionHintTarget_ActivityCollectors_JsonCodec())
    public static get instance(): ExpressionHintTarget_ActivityCollectors_JsonCodec {
        return ExpressionHintTarget_ActivityCollectors_JsonCodec.lazyInstance.value
    }
}

export class ExpressionHintTarget_ActivityJobs implements BaboonAdtMemberMeta, BaboonGenerated {
    public readonly $type = 'chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs' as const;
    private readonly _scope: ActivityJobScope;
    private readonly _collectorId: string | undefined;

    constructor(scope: ActivityJobScope, collectorId: string | undefined) {
        this._scope = scope
        this._collectorId = collectorId
    }

    public get scope(): ActivityJobScope {
        return this._scope;
    }
    public get collectorId(): string | undefined {
        return this._collectorId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            collectorId: this._collectorId !== undefined ? this._collectorId : undefined
        };
    }

    public with(overrides: {scope?: ActivityJobScope; collectorId?: string | undefined}): ExpressionHintTarget_ActivityJobs {
        return new ExpressionHintTarget_ActivityJobs(
            'scope' in overrides ? overrides.scope! : this._scope,
            'collectorId' in overrides ? overrides.collectorId! : this._collectorId
        );
    }

    public static fromPlain(obj: {scope: ActivityJobScope; collectorId: string | undefined}): ExpressionHintTarget_ActivityJobs {
        return new ExpressionHintTarget_ActivityJobs(
            obj.scope,
            obj.collectorId
        );
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return ExpressionHintTarget_ActivityJobs.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ExpressionHintTarget_ActivityJobs.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs'
    public baboonTypeIdentifier() {
        return ExpressionHintTarget_ActivityJobs.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return ExpressionHintTarget_ActivityJobs.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return ExpressionHintTarget_ActivityJobs.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return ExpressionHintTarget_ActivityJobs.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ExpressionHintTarget'
    public baboonAdtTypeIdentifier() {
        return ExpressionHintTarget_ActivityJobs.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ExpressionHintTarget_ActivityJobs_JsonCodec {
        return ExpressionHintTarget_ActivityJobs_JsonCodec.instance
    }
}

/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.7.0 */
export class ExpressionHintTarget_ActivityJobs_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ExpressionHintTarget_ActivityJobs): unknown {
        if (this !== ExpressionHintTarget_ActivityJobs_JsonCodec.lazyInstance.value) {
          return ExpressionHintTarget_ActivityJobs_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": ActivityJobScope_JsonCodec.instance.encode(BaboonCodecContext.Default, value.scope),
            "collectorId": value.collectorId === undefined ? null : value.collectorId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ExpressionHintTarget_ActivityJobs {
        if (this !== ExpressionHintTarget_ActivityJobs_JsonCodec .lazyInstance.value) {
            return ExpressionHintTarget_ActivityJobs_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ExpressionHintTarget_ActivityJobs (
            ActivityJobScope_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["scope"]),
            obj["collectorId"] === undefined || obj["collectorId"] === null ? undefined : obj["collectorId"] === undefined || obj["collectorId"] === null ? undefined : obj["collectorId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return ExpressionHintTarget_ActivityJobs_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ExpressionHintTarget_ActivityJobs_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs'
    public baboonTypeIdentifier() {
        return ExpressionHintTarget_ActivityJobs_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ExpressionHintTarget'
    public baboonAdtTypeIdentifier() {
        return ExpressionHintTarget_ActivityJobs_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ExpressionHintTarget_ActivityJobs_JsonCodec())
    public static get instance(): ExpressionHintTarget_ActivityJobs_JsonCodec {
        return ExpressionHintTarget_ActivityJobs_JsonCodec.lazyInstance.value
    }
}


/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.7.0 */
export class ExpressionHintTarget_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ExpressionHintTarget): unknown {
        if (this !== ExpressionHintTarget_JsonCodec.lazyInstance.value) {
          return ExpressionHintTarget_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof ExpressionHintTarget_Archive) {
                return { "Archive": ExpressionHintTarget_Archive_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ExpressionHintTarget_ActivityCollectors) {
                return { "ActivityCollectors": ExpressionHintTarget_ActivityCollectors_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ExpressionHintTarget_ActivityJobs) {
                return { "ActivityJobs": ExpressionHintTarget_ActivityJobs_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ExpressionHintTarget {
        if (this !== ExpressionHintTarget_JsonCodec .lazyInstance.value) {
            return ExpressionHintTarget_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Archive": return ExpressionHintTarget_Archive_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ActivityCollectors": return ExpressionHintTarget_ActivityCollectors_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ActivityJobs": return ExpressionHintTarget_ActivityJobs_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return ExpressionHintTarget_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ExpressionHintTarget_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ExpressionHintTarget'
    public baboonTypeIdentifier() {
        return ExpressionHintTarget_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'chronicle.api/:#ExpressionHintTarget'
    public baboonAdtTypeIdentifier() {
        return ExpressionHintTarget_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ExpressionHintTarget_JsonCodec())
    public static get instance(): ExpressionHintTarget_JsonCodec {
        return ExpressionHintTarget_JsonCodec.lazyInstance.value
    }
}