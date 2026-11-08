import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class UserInfo implements BaboonGeneratedLatest {
    private readonly _id: string;
    private readonly _login: string;

    constructor(id: string, login: string) {
        this._id = id
        this._login = login
    }

    public get id(): string {
        return this._id;
    }
    public get login(): string {
        return this._login;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            login: this._login
        };
    }

    public with(overrides: {id?: string; login?: string}): UserInfo {
        return new UserInfo(
            'id' in overrides ? overrides.id! : this._id,
            'login' in overrides ? overrides.login! : this._login
        );
    }

    public static fromPlain(obj: {id: string; login: string}): UserInfo {
        return new UserInfo(
            obj.id,
            obj.login
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return UserInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return UserInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#UserInfo'
    public baboonTypeIdentifier() {
        return UserInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return UserInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return UserInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return UserInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): UserInfo_JsonCodec {
        return UserInfo_JsonCodec.instance
    }
}

export class UserInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: UserInfo): unknown {
        if (this !== UserInfo_JsonCodec.lazyInstance.value) {
          return UserInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "login": value.login,
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
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return UserInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return UserInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#UserInfo'
    public baboonTypeIdentifier() {
        return UserInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new UserInfo_JsonCodec())
    public static get instance(): UserInfo_JsonCodec {
        return UserInfo_JsonCodec.lazyInstance.value
    }
}