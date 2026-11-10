import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class LoginRequest implements BaboonGeneratedLatest {
    private readonly _token: string;

    constructor(token: string) {
        this._token = token
    }

    public get token(): string {
        return this._token;
    }

    public toJSON(): Record<string, unknown> {
        return {
            token: this._token
        };
    }

    public with(overrides: {token?: string}): LoginRequest {
        return new LoginRequest(
            'token' in overrides ? overrides.token! : this._token
        );
    }

    public static fromPlain(obj: {token: string}): LoginRequest {
        return new LoginRequest(
            obj.token
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return LoginRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return LoginRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#LoginRequest'
    public baboonTypeIdentifier() {
        return LoginRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return LoginRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return LoginRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
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
            "token": value.token,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): LoginRequest {
        if (this !== LoginRequest_JsonCodec .lazyInstance.value) {
            return LoginRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new LoginRequest (
            obj["token"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return LoginRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return LoginRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#LoginRequest'
    public baboonTypeIdentifier() {
        return LoginRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new LoginRequest_JsonCodec())
    public static get instance(): LoginRequest_JsonCodec {
        return LoginRequest_JsonCodec.lazyInstance.value
    }
}