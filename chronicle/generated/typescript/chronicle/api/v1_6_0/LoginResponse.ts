import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {UserInfo, UserInfo_JsonCodec} from './UserInfo.js'
import {VersionInfo, VersionInfo_JsonCodec} from './VersionInfo.js'

export class LoginResponse implements BaboonGenerated {
    private readonly _user: UserInfo;
    private readonly _versions: VersionInfo;

    constructor(user: UserInfo, versions: VersionInfo) {
        this._user = user
        this._versions = versions
    }

    public get user(): UserInfo {
        return this._user;
    }
    public get versions(): VersionInfo {
        return this._versions;
    }

    public toJSON(): Record<string, unknown> {
        return {
            user: this._user,
            versions: this._versions
        };
    }

    public with(overrides: {user?: UserInfo; versions?: VersionInfo}): LoginResponse {
        return new LoginResponse(
            'user' in overrides ? overrides.user! : this._user,
            'versions' in overrides ? overrides.versions! : this._versions
        );
    }

    public static fromPlain(obj: {user: UserInfo; versions: VersionInfo}): LoginResponse {
        return new LoginResponse(
            obj.user,
            obj.versions
        );
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return LoginResponse.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return LoginResponse.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#LoginResponse'
    public baboonTypeIdentifier() {
        return LoginResponse.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return LoginResponse.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return LoginResponse.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return LoginResponse.BaboonMinReaderVersions
    }
    public static jsonCodec(): LoginResponse_JsonCodec {
        return LoginResponse_JsonCodec.instance
    }
}

/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.7.0 */
export class LoginResponse_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: LoginResponse): unknown {
        if (this !== LoginResponse_JsonCodec.lazyInstance.value) {
          return LoginResponse_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "user": UserInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.user),
            "versions": VersionInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.versions),
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
        )
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return LoginResponse_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return LoginResponse_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#LoginResponse'
    public baboonTypeIdentifier() {
        return LoginResponse_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new LoginResponse_JsonCodec())
    public static get instance(): LoginResponse_JsonCodec {
        return LoginResponse_JsonCodec.lazyInstance.value
    }
}