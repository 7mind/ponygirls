import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export type ExpiryChange = ExpiryChange_Keep | ExpiryChange_Clear | ExpiryChange_Set

export const ExpiryChange = {
    BaboonDomainVersion: '1.0.0',
    BaboonDomainIdentifier: 'manure.api',
    BaboonTypeIdentifier: 'manure.api/:#ExpiryChange',
    BaboonSameInVersions: ["1.0.0"],
    BaboonForwardReadable: { "1.0.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'manure.api/:#ExpiryChange',
    jsonCodec(): ExpiryChange_JsonCodec {
        return ExpiryChange_JsonCodec.instance
    }
} as const

export class ExpiryChange_Keep implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#ExpiryChange]#Keep' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): ExpiryChange_Keep {
        return new ExpiryChange_Keep(
            
        );
    }

    public static fromPlain(obj: {}): ExpiryChange_Keep {
        return new ExpiryChange_Keep(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ExpiryChange_Keep.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ExpiryChange_Keep.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ExpiryChange]#Keep'
    public baboonTypeIdentifier() {
        return ExpiryChange_Keep.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ExpiryChange_Keep.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ExpiryChange_Keep.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ExpiryChange_Keep.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ExpiryChange'
    public baboonAdtTypeIdentifier() {
        return ExpiryChange_Keep.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ExpiryChange_Keep_JsonCodec {
        return ExpiryChange_Keep_JsonCodec.instance
    }
}

export class ExpiryChange_Keep_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ExpiryChange_Keep): unknown {
        if (this !== ExpiryChange_Keep_JsonCodec.lazyInstance.value) {
          return ExpiryChange_Keep_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ExpiryChange_Keep {
        if (this !== ExpiryChange_Keep_JsonCodec .lazyInstance.value) {
            return ExpiryChange_Keep_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ExpiryChange_Keep (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ExpiryChange_Keep_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ExpiryChange_Keep_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ExpiryChange]#Keep'
    public baboonTypeIdentifier() {
        return ExpiryChange_Keep_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ExpiryChange'
    public baboonAdtTypeIdentifier() {
        return ExpiryChange_Keep_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ExpiryChange_Keep_JsonCodec())
    public static get instance(): ExpiryChange_Keep_JsonCodec {
        return ExpiryChange_Keep_JsonCodec.lazyInstance.value
    }
}

export class ExpiryChange_Clear implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#ExpiryChange]#Clear' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): ExpiryChange_Clear {
        return new ExpiryChange_Clear(
            
        );
    }

    public static fromPlain(obj: {}): ExpiryChange_Clear {
        return new ExpiryChange_Clear(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ExpiryChange_Clear.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ExpiryChange_Clear.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ExpiryChange]#Clear'
    public baboonTypeIdentifier() {
        return ExpiryChange_Clear.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ExpiryChange_Clear.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ExpiryChange_Clear.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ExpiryChange_Clear.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ExpiryChange'
    public baboonAdtTypeIdentifier() {
        return ExpiryChange_Clear.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ExpiryChange_Clear_JsonCodec {
        return ExpiryChange_Clear_JsonCodec.instance
    }
}

export class ExpiryChange_Clear_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ExpiryChange_Clear): unknown {
        if (this !== ExpiryChange_Clear_JsonCodec.lazyInstance.value) {
          return ExpiryChange_Clear_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ExpiryChange_Clear {
        if (this !== ExpiryChange_Clear_JsonCodec .lazyInstance.value) {
            return ExpiryChange_Clear_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ExpiryChange_Clear (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ExpiryChange_Clear_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ExpiryChange_Clear_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ExpiryChange]#Clear'
    public baboonTypeIdentifier() {
        return ExpiryChange_Clear_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ExpiryChange'
    public baboonAdtTypeIdentifier() {
        return ExpiryChange_Clear_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ExpiryChange_Clear_JsonCodec())
    public static get instance(): ExpiryChange_Clear_JsonCodec {
        return ExpiryChange_Clear_JsonCodec.lazyInstance.value
    }
}

export class ExpiryChange_Set implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#ExpiryChange]#Set' as const;
    private readonly _seconds: number;

    constructor(seconds: number) {
        this._seconds = seconds
    }

    public get seconds(): number {
        return this._seconds;
    }

    public toJSON(): Record<string, unknown> {
        return {
            seconds: this._seconds
        };
    }

    public with(overrides: {seconds?: number}): ExpiryChange_Set {
        return new ExpiryChange_Set(
            'seconds' in overrides ? overrides.seconds! : this._seconds
        );
    }

    public static fromPlain(obj: {seconds: number}): ExpiryChange_Set {
        return new ExpiryChange_Set(
            obj.seconds
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ExpiryChange_Set.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ExpiryChange_Set.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ExpiryChange]#Set'
    public baboonTypeIdentifier() {
        return ExpiryChange_Set.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ExpiryChange_Set.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ExpiryChange_Set.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ExpiryChange_Set.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ExpiryChange'
    public baboonAdtTypeIdentifier() {
        return ExpiryChange_Set.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ExpiryChange_Set_JsonCodec {
        return ExpiryChange_Set_JsonCodec.instance
    }
}

export class ExpiryChange_Set_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ExpiryChange_Set): unknown {
        if (this !== ExpiryChange_Set_JsonCodec.lazyInstance.value) {
          return ExpiryChange_Set_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "seconds": value.seconds,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ExpiryChange_Set {
        if (this !== ExpiryChange_Set_JsonCodec .lazyInstance.value) {
            return ExpiryChange_Set_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ExpiryChange_Set (
            obj["seconds"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ExpiryChange_Set_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ExpiryChange_Set_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ExpiryChange]#Set'
    public baboonTypeIdentifier() {
        return ExpiryChange_Set_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ExpiryChange'
    public baboonAdtTypeIdentifier() {
        return ExpiryChange_Set_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ExpiryChange_Set_JsonCodec())
    public static get instance(): ExpiryChange_Set_JsonCodec {
        return ExpiryChange_Set_JsonCodec.lazyInstance.value
    }
}


export class ExpiryChange_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ExpiryChange): unknown {
        if (this !== ExpiryChange_JsonCodec.lazyInstance.value) {
          return ExpiryChange_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof ExpiryChange_Keep) {
                return { "Keep": ExpiryChange_Keep_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ExpiryChange_Clear) {
                return { "Clear": ExpiryChange_Clear_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ExpiryChange_Set) {
                return { "Set": ExpiryChange_Set_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ExpiryChange {
        if (this !== ExpiryChange_JsonCodec .lazyInstance.value) {
            return ExpiryChange_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Keep": return ExpiryChange_Keep_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Clear": return ExpiryChange_Clear_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Set": return ExpiryChange_Set_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ExpiryChange_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ExpiryChange_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ExpiryChange'
    public baboonTypeIdentifier() {
        return ExpiryChange_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ExpiryChange'
    public baboonAdtTypeIdentifier() {
        return ExpiryChange_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ExpiryChange_JsonCodec())
    public static get instance(): ExpiryChange_JsonCodec {
        return ExpiryChange_JsonCodec.lazyInstance.value
    }
}