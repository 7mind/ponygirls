import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {TokenInfo, TokenInfo_JsonCodec} from './TokenInfo.js'

export class TokenResult implements BaboonGenerated {
    private readonly _token: TokenInfo;
    private readonly _secret: string | undefined;

    constructor(token: TokenInfo, secret: string | undefined) {
        this._token = token
        this._secret = secret
    }

    public get token(): TokenInfo {
        return this._token;
    }
    public get secret(): string | undefined {
        return this._secret;
    }

    public toJSON(): Record<string, unknown> {
        return {
            token: this._token,
            secret: this._secret !== undefined ? this._secret : undefined
        };
    }

    public with(overrides: {token?: TokenInfo; secret?: string | undefined}): TokenResult {
        return new TokenResult(
            'token' in overrides ? overrides.token! : this._token,
            'secret' in overrides ? overrides.secret! : this._secret
        );
    }

    public static fromPlain(obj: {token: TokenInfo; secret: string | undefined}): TokenResult {
        return new TokenResult(
            obj.token,
            obj.secret
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return TokenResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return TokenResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#TokenResult'
    public baboonTypeIdentifier() {
        return TokenResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return TokenResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical", "1.1.0": "identical", "1.2.0": "identical", "1.3.0": "identical", "1.4.0": "identical" }
    public baboonForwardReadable() {
        return TokenResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return TokenResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): TokenResult_JsonCodec {
        return TokenResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.0.0 is deprecated, you should migrate to 1.4.0 */
export class TokenResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: TokenResult): unknown {
        if (this !== TokenResult_JsonCodec.lazyInstance.value) {
          return TokenResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "token": TokenInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.token),
            "secret": value.secret === undefined ? null : value.secret,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): TokenResult {
        if (this !== TokenResult_JsonCodec .lazyInstance.value) {
            return TokenResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new TokenResult (
            TokenInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["token"]),
            obj["secret"] === undefined || obj["secret"] === null ? undefined : obj["secret"] === undefined || obj["secret"] === null ? undefined : obj["secret"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return TokenResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return TokenResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#TokenResult'
    public baboonTypeIdentifier() {
        return TokenResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new TokenResult_JsonCodec())
    public static get instance(): TokenResult_JsonCodec {
        return TokenResult_JsonCodec.lazyInstance.value
    }
}