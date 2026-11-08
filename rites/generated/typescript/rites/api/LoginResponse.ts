import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {UserInfo, UserInfo_JsonCodec} from './UserInfo.js'
import {VersionInfo, VersionInfo_JsonCodec} from './VersionInfo.js'

export class LoginResponse implements BaboonGeneratedLatest {
    private readonly _user: UserInfo;
    private readonly _versions: VersionInfo;
    private readonly _sessionTtlSeconds: bigint;

    constructor(user: UserInfo, versions: VersionInfo, sessionTtlSeconds: bigint) {
        this._user = user
        this._versions = versions
        this._sessionTtlSeconds = sessionTtlSeconds
    }

    public get user(): UserInfo {
        return this._user;
    }
    public get versions(): VersionInfo {
        return this._versions;
    }
    public get sessionTtlSeconds(): bigint {
        return this._sessionTtlSeconds;
    }

    public toJSON(): Record<string, unknown> {
        return {
            user: this._user,
            versions: this._versions,
            sessionTtlSeconds: this._sessionTtlSeconds
        };
    }

    public with(overrides: {user?: UserInfo; versions?: VersionInfo; sessionTtlSeconds?: bigint}): LoginResponse {
        return new LoginResponse(
            'user' in overrides ? overrides.user! : this._user,
            'versions' in overrides ? overrides.versions! : this._versions,
            'sessionTtlSeconds' in overrides ? overrides.sessionTtlSeconds! : this._sessionTtlSeconds
        );
    }

    public static fromPlain(obj: {user: UserInfo; versions: VersionInfo; sessionTtlSeconds: bigint}): LoginResponse {
        return new LoginResponse(
            obj.user,
            obj.versions,
            obj.sessionTtlSeconds
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return LoginResponse.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return LoginResponse.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#LoginResponse'
    public baboonTypeIdentifier() {
        return LoginResponse.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return LoginResponse.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return LoginResponse.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return LoginResponse.BaboonMinReaderVersions
    }
    public static jsonCodec(): LoginResponse_JsonCodec {
        return LoginResponse_JsonCodec.instance
    }
}

export class LoginResponse_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: LoginResponse): unknown {
        if (this !== LoginResponse_JsonCodec.lazyInstance.value) {
          return LoginResponse_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "user": UserInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.user),
            "versions": VersionInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.versions),
            "sessionTtlSeconds": value.sessionTtlSeconds.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): LoginResponse {
        if (this !== LoginResponse_JsonCodec .lazyInstance.value) {
            return LoginResponse_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new LoginResponse (
            UserInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["user"]),
            VersionInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["versions"]),
            BaboonInt64.read(obj["sessionTtlSeconds"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return LoginResponse_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return LoginResponse_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#LoginResponse'
    public baboonTypeIdentifier() {
        return LoginResponse_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new LoginResponse_JsonCodec())
    public static get instance(): LoginResponse_JsonCodec {
        return LoginResponse_JsonCodec.lazyInstance.value
    }
}