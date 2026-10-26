import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class LoginRequest implements BaboonGeneratedLatest {
    private readonly _login: string;
    private readonly _password: string;

    constructor(login: string, password: string) {
        this._login = login
        this._password = password
    }

    public get login(): string {
        return this._login;
    }
    public get password(): string {
        return this._password;
    }

    public toJSON(): Record<string, unknown> {
        return {
            login: this._login,
            password: this._password
        };
    }

    public with(overrides: {login?: string; password?: string}): LoginRequest {
        return new LoginRequest(
            'login' in overrides ? overrides.login! : this._login,
            'password' in overrides ? overrides.password! : this._password
        );
    }

    public static fromPlain(obj: {login: string; password: string}): LoginRequest {
        return new LoginRequest(
            obj.login,
            obj.password
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return LoginRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return LoginRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#LoginRequest'
    public baboonTypeIdentifier() {
        return LoginRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return LoginRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
    public baboonForwardReadable() {
        return LoginRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return LoginRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): LoginRequest_JsonCodec {
        return LoginRequest_JsonCodec.instance
    }
}

export class LoginRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: LoginRequest): unknown {
        if (this !== LoginRequest_JsonCodec.lazyInstance.value) {
          return LoginRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "login": value.login,
            "password": value.password,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): LoginRequest {
        if (this !== LoginRequest_JsonCodec .lazyInstance.value) {
            return LoginRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new LoginRequest (
            obj["login"] as string,
            obj["password"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return LoginRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return LoginRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#LoginRequest'
    public baboonTypeIdentifier() {
        return LoginRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new LoginRequest_JsonCodec())
    public static get instance(): LoginRequest_JsonCodec {
        return LoginRequest_JsonCodec.lazyInstance.value
    }
}