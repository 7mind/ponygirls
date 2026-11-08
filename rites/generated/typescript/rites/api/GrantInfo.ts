import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {GrantRole, GrantRole_JsonCodec} from './GrantRole.js'

export class GrantInfo implements BaboonGeneratedLatest {
    private readonly _userId: string;
    private readonly _login: string;
    private readonly _role: GrantRole;

    constructor(userId: string, login: string, role: GrantRole) {
        this._userId = userId
        this._login = login
        this._role = role
    }

    public get userId(): string {
        return this._userId;
    }
    public get login(): string {
        return this._login;
    }
    public get role(): GrantRole {
        return this._role;
    }

    public toJSON(): Record<string, unknown> {
        return {
            userId: this._userId,
            login: this._login,
            role: this._role
        };
    }

    public with(overrides: {userId?: string; login?: string; role?: GrantRole}): GrantInfo {
        return new GrantInfo(
            'userId' in overrides ? overrides.userId! : this._userId,
            'login' in overrides ? overrides.login! : this._login,
            'role' in overrides ? overrides.role! : this._role
        );
    }

    public static fromPlain(obj: {userId: string; login: string; role: GrantRole}): GrantInfo {
        return new GrantInfo(
            obj.userId,
            obj.login,
            obj.role
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return GrantInfo.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return GrantInfo.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#GrantInfo'
    public baboonTypeIdentifier() {
        return GrantInfo.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return GrantInfo.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return GrantInfo.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return GrantInfo.BaboonMinReaderVersions
    }
    public static jsonCodec(): GrantInfo_JsonCodec {
        return GrantInfo_JsonCodec.instance
    }
}

export class GrantInfo_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GrantInfo): unknown {
        if (this !== GrantInfo_JsonCodec.lazyInstance.value) {
          return GrantInfo_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "userId": value.userId,
            "login": value.login,
            "role": GrantRole_JsonCodec.instance.encode(BaboonCodecContext.Default, value.role),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GrantInfo {
        if (this !== GrantInfo_JsonCodec .lazyInstance.value) {
            return GrantInfo_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new GrantInfo (
            obj["userId"] as string,
            obj["login"] as string,
            GrantRole_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["role"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return GrantInfo_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return GrantInfo_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#GrantInfo'
    public baboonTypeIdentifier() {
        return GrantInfo_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GrantInfo_JsonCodec())
    public static get instance(): GrantInfo_JsonCodec {
        return GrantInfo_JsonCodec.lazyInstance.value
    }
}