import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {Scope, Scope_JsonCodec} from './Scope.js'

export class TokenInfo implements BaboonGenerated {
    private readonly _id: string;
    private readonly _name: string;
    private readonly _scopes: Array<Scope>;
    private readonly _createdAt: string;
    private readonly _revoked: boolean;

    constructor(id: string, name: string, scopes: Array<Scope>, createdAt: string, revoked: boolean) {
        this._id = id
        this._name = name
        this._scopes = scopes
        this._createdAt = createdAt
        this._revoked = revoked
    }

    public get id(): string {
        return this._id;
    }
    public get name(): string {
        return this._name;
    }
    public get scopes(): Array<Scope> {
        return this._scopes;
    }
    public get createdAt(): string {
        return this._createdAt;
    }
    public get revoked(): boolean {
        return this._revoked;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            name: this._name,
            scopes: this._scopes,
            createdAt: this._createdAt,
            revoked: this._revoked
        };
    }

    public with(overrides: {id?: string; name?: string; scopes?: Array<Scope>; createdAt?: string; revoked?: boolean}): TokenInfo {
        return new TokenInfo(
            'id' in overrides ? overrides.id! : this._id,
            'name' in overrides ? overrides.name! : this._name,
            'scopes' in overrides ? overrides.scopes! : this._scopes,
            'createdAt' in overrides ? overrides.createdAt! : this._createdAt,
            'revoked' in overrides ? overrides.revoked! : this._revoked
        );
    }

    public static fromPlain(obj: {id: string; name: string; scopes: Array<Scope>; createdAt: string; revoked: boolean}): TokenInfo {
        return new TokenInfo(
            obj.id,
            obj.name,
            obj.scopes,
            obj.createdAt,
            obj.revoked
        );
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return TokenInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return TokenInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#TokenInfo'
    public baboonTypeIdentifier() {
        return TokenInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return TokenInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.6.0": "identical", "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return TokenInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return TokenInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): TokenInfo_JsonCodec {
        return TokenInfo_JsonCodec.instance
    }
}

/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.8.0 */
export class TokenInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: TokenInfo): unknown {
        if (this !== TokenInfo_JsonCodec.lazyInstance.value) {
          return TokenInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "name": value.name,
            "scopes": Array.from(value.scopes).map(item => Scope_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "createdAt": value.createdAt,
            "revoked": value.revoked,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): TokenInfo {
        if (this !== TokenInfo_JsonCodec .lazyInstance.value) {
            return TokenInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new TokenInfo (
            obj["id"] as string,
            obj["name"] as string,
            (obj["scopes"] as unknown[]).map(item => Scope_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["createdAt"] as string,
            obj["revoked"] as boolean,
        )
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return TokenInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return TokenInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#TokenInfo'
    public baboonTypeIdentifier() {
        return TokenInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new TokenInfo_JsonCodec())
    public static get instance(): TokenInfo_JsonCodec {
        return TokenInfo_JsonCodec.lazyInstance.value
    }
}