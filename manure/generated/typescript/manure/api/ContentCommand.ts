import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export type ContentCommand = ContentCommand_Unlock | ContentCommand_RedeemGrant | ContentCommand_Logout | ContentCommand_GetManifest

export const ContentCommand = {
    BaboonDomainVersion: '1.0.0',
    BaboonDomainIdentifier: 'manure.api',
    BaboonTypeIdentifier: 'manure.api/:#ContentCommand',
    BaboonSameInVersions: ["1.0.0"],
    BaboonForwardReadable: { "1.0.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'manure.api/:#ContentCommand',
    jsonCodec(): ContentCommand_JsonCodec {
        return ContentCommand_JsonCodec.instance
    }
} as const

export class ContentCommand_Unlock implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#ContentCommand]#Unlock' as const;
    private readonly _password: string;

    constructor(password: string) {
        this._password = password
    }

    public get password(): string {
        return this._password;
    }

    public toJSON(): Record<string, unknown> {
        return {
            password: this._password
        };
    }

    public with(overrides: {password?: string}): ContentCommand_Unlock {
        return new ContentCommand_Unlock(
            'password' in overrides ? overrides.password! : this._password
        );
    }

    public static fromPlain(obj: {password: string}): ContentCommand_Unlock {
        return new ContentCommand_Unlock(
            obj.password
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ContentCommand_Unlock.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ContentCommand_Unlock.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#Unlock'
    public baboonTypeIdentifier() {
        return ContentCommand_Unlock.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ContentCommand_Unlock.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ContentCommand_Unlock.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ContentCommand_Unlock.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand'
    public baboonAdtTypeIdentifier() {
        return ContentCommand_Unlock.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ContentCommand_Unlock_JsonCodec {
        return ContentCommand_Unlock_JsonCodec.instance
    }
}

export class ContentCommand_Unlock_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentCommand_Unlock): unknown {
        if (this !== ContentCommand_Unlock_JsonCodec.lazyInstance.value) {
          return ContentCommand_Unlock_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "password": value.password,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentCommand_Unlock {
        if (this !== ContentCommand_Unlock_JsonCodec .lazyInstance.value) {
            return ContentCommand_Unlock_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentCommand_Unlock (
            obj["password"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ContentCommand_Unlock_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ContentCommand_Unlock_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#Unlock'
    public baboonTypeIdentifier() {
        return ContentCommand_Unlock_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand'
    public baboonAdtTypeIdentifier() {
        return ContentCommand_Unlock_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentCommand_Unlock_JsonCodec())
    public static get instance(): ContentCommand_Unlock_JsonCodec {
        return ContentCommand_Unlock_JsonCodec.lazyInstance.value
    }
}

export class ContentCommand_RedeemGrant implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#ContentCommand]#RedeemGrant' as const;
    private readonly _grant: string;

    constructor(grant: string) {
        this._grant = grant
    }

    public get grant(): string {
        return this._grant;
    }

    public toJSON(): Record<string, unknown> {
        return {
            grant: this._grant
        };
    }

    public with(overrides: {grant?: string}): ContentCommand_RedeemGrant {
        return new ContentCommand_RedeemGrant(
            'grant' in overrides ? overrides.grant! : this._grant
        );
    }

    public static fromPlain(obj: {grant: string}): ContentCommand_RedeemGrant {
        return new ContentCommand_RedeemGrant(
            obj.grant
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ContentCommand_RedeemGrant.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ContentCommand_RedeemGrant.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#RedeemGrant'
    public baboonTypeIdentifier() {
        return ContentCommand_RedeemGrant.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ContentCommand_RedeemGrant.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ContentCommand_RedeemGrant.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ContentCommand_RedeemGrant.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand'
    public baboonAdtTypeIdentifier() {
        return ContentCommand_RedeemGrant.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ContentCommand_RedeemGrant_JsonCodec {
        return ContentCommand_RedeemGrant_JsonCodec.instance
    }
}

export class ContentCommand_RedeemGrant_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentCommand_RedeemGrant): unknown {
        if (this !== ContentCommand_RedeemGrant_JsonCodec.lazyInstance.value) {
          return ContentCommand_RedeemGrant_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "grant": value.grant,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentCommand_RedeemGrant {
        if (this !== ContentCommand_RedeemGrant_JsonCodec .lazyInstance.value) {
            return ContentCommand_RedeemGrant_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentCommand_RedeemGrant (
            obj["grant"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ContentCommand_RedeemGrant_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ContentCommand_RedeemGrant_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#RedeemGrant'
    public baboonTypeIdentifier() {
        return ContentCommand_RedeemGrant_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand'
    public baboonAdtTypeIdentifier() {
        return ContentCommand_RedeemGrant_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentCommand_RedeemGrant_JsonCodec())
    public static get instance(): ContentCommand_RedeemGrant_JsonCodec {
        return ContentCommand_RedeemGrant_JsonCodec.lazyInstance.value
    }
}

export class ContentCommand_Logout implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#ContentCommand]#Logout' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): ContentCommand_Logout {
        return new ContentCommand_Logout(
            
        );
    }

    public static fromPlain(obj: {}): ContentCommand_Logout {
        return new ContentCommand_Logout(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ContentCommand_Logout.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ContentCommand_Logout.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#Logout'
    public baboonTypeIdentifier() {
        return ContentCommand_Logout.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ContentCommand_Logout.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ContentCommand_Logout.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ContentCommand_Logout.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand'
    public baboonAdtTypeIdentifier() {
        return ContentCommand_Logout.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ContentCommand_Logout_JsonCodec {
        return ContentCommand_Logout_JsonCodec.instance
    }
}

export class ContentCommand_Logout_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentCommand_Logout): unknown {
        if (this !== ContentCommand_Logout_JsonCodec.lazyInstance.value) {
          return ContentCommand_Logout_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentCommand_Logout {
        if (this !== ContentCommand_Logout_JsonCodec .lazyInstance.value) {
            return ContentCommand_Logout_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentCommand_Logout (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ContentCommand_Logout_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ContentCommand_Logout_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#Logout'
    public baboonTypeIdentifier() {
        return ContentCommand_Logout_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand'
    public baboonAdtTypeIdentifier() {
        return ContentCommand_Logout_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentCommand_Logout_JsonCodec())
    public static get instance(): ContentCommand_Logout_JsonCodec {
        return ContentCommand_Logout_JsonCodec.lazyInstance.value
    }
}

export class ContentCommand_GetManifest implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'manure.api/[manure.api/:#ContentCommand]#GetManifest' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): ContentCommand_GetManifest {
        return new ContentCommand_GetManifest(
            
        );
    }

    public static fromPlain(obj: {}): ContentCommand_GetManifest {
        return new ContentCommand_GetManifest(
            
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ContentCommand_GetManifest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ContentCommand_GetManifest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#GetManifest'
    public baboonTypeIdentifier() {
        return ContentCommand_GetManifest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ContentCommand_GetManifest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ContentCommand_GetManifest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ContentCommand_GetManifest.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand'
    public baboonAdtTypeIdentifier() {
        return ContentCommand_GetManifest.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): ContentCommand_GetManifest_JsonCodec {
        return ContentCommand_GetManifest_JsonCodec.instance
    }
}

export class ContentCommand_GetManifest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentCommand_GetManifest): unknown {
        if (this !== ContentCommand_GetManifest_JsonCodec.lazyInstance.value) {
          return ContentCommand_GetManifest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentCommand_GetManifest {
        if (this !== ContentCommand_GetManifest_JsonCodec .lazyInstance.value) {
            return ContentCommand_GetManifest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentCommand_GetManifest (
            
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ContentCommand_GetManifest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ContentCommand_GetManifest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/[manure.api/:#ContentCommand]#GetManifest'
    public baboonTypeIdentifier() {
        return ContentCommand_GetManifest_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand'
    public baboonAdtTypeIdentifier() {
        return ContentCommand_GetManifest_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentCommand_GetManifest_JsonCodec())
    public static get instance(): ContentCommand_GetManifest_JsonCodec {
        return ContentCommand_GetManifest_JsonCodec.lazyInstance.value
    }
}


export class ContentCommand_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentCommand): unknown {
        if (this !== ContentCommand_JsonCodec.lazyInstance.value) {
          return ContentCommand_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof ContentCommand_Unlock) {
                return { "Unlock": ContentCommand_Unlock_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ContentCommand_RedeemGrant) {
                return { "RedeemGrant": ContentCommand_RedeemGrant_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ContentCommand_Logout) {
                return { "Logout": ContentCommand_Logout_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof ContentCommand_GetManifest) {
                return { "GetManifest": ContentCommand_GetManifest_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentCommand {
        if (this !== ContentCommand_JsonCodec .lazyInstance.value) {
            return ContentCommand_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Unlock": return ContentCommand_Unlock_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "RedeemGrant": return ContentCommand_RedeemGrant_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Logout": return ContentCommand_Logout_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "GetManifest": return ContentCommand_GetManifest_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ContentCommand_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ContentCommand_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ContentCommand'
    public baboonTypeIdentifier() {
        return ContentCommand_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'manure.api/:#ContentCommand'
    public baboonAdtTypeIdentifier() {
        return ContentCommand_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentCommand_JsonCodec())
    public static get instance(): ContentCommand_JsonCodec {
        return ContentCommand_JsonCodec.lazyInstance.value
    }
}