import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {Scope, Scope_JsonCodec} from './Scope.js'

export class UserInfo implements BaboonGenerated {
    private readonly _id: string;
    private readonly _login: string;
    private readonly _scopes: Array<Scope>;

    constructor(id: string, login: string, scopes: Array<Scope>) {
        this._id = id
        this._login = login
        this._scopes = scopes
    }

    public get id(): string {
        return this._id;
    }
    public get login(): string {
        return this._login;
    }
    public get scopes(): Array<Scope> {
        return this._scopes;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            login: this._login,
            scopes: this._scopes
        };
    }

    public with(overrides: {id?: string; login?: string; scopes?: Array<Scope>}): UserInfo {
        return new UserInfo(
            'id' in overrides ? overrides.id! : this._id,
            'login' in overrides ? overrides.login! : this._login,
            'scopes' in overrides ? overrides.scopes! : this._scopes
        );
    }

    public static fromPlain(obj: {id: string; login: string; scopes: Array<Scope>}): UserInfo {
        return new UserInfo(
            obj.id,
            obj.login,
            obj.scopes
        );
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return UserInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return UserInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#UserInfo'
    public baboonTypeIdentifier() {
        return UserInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return UserInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.6.0": "identical", "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return UserInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return UserInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): UserInfo_JsonCodec {
        return UserInfo_JsonCodec.instance
    }
}

/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.8.0 */
export class UserInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: UserInfo): unknown {
        if (this !== UserInfo_JsonCodec.lazyInstance.value) {
          return UserInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "login": value.login,
            "scopes": Array.from(value.scopes).map(item => Scope_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): UserInfo {
        if (this !== UserInfo_JsonCodec .lazyInstance.value) {
            return UserInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new UserInfo (
            obj["id"] as string,
            obj["login"] as string,
            (obj["scopes"] as unknown[]).map(item => Scope_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return UserInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return UserInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#UserInfo'
    public baboonTypeIdentifier() {
        return UserInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new UserInfo_JsonCodec())
    public static get instance(): UserInfo_JsonCodec {
        return UserInfo_JsonCodec.lazyInstance.value
    }
}