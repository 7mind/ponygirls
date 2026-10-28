import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {ListedToken, ListedToken_JsonCodec} from './ListedToken.js'

export class TokensResult implements BaboonGenerated {
    private readonly _tokens: Array<ListedToken>;

    constructor(tokens: Array<ListedToken>) {
        this._tokens = tokens
    }

    public get tokens(): Array<ListedToken> {
        return this._tokens;
    }

    public toJSON(): Record<string, unknown> {
        return {
            tokens: this._tokens
        };
    }

    public with(overrides: {tokens?: Array<ListedToken>}): TokensResult {
        return new TokensResult(
            'tokens' in overrides ? overrides.tokens! : this._tokens
        );
    }

    public static fromPlain(obj: {tokens: Array<ListedToken>}): TokensResult {
        return new TokensResult(
            obj.tokens
        );
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return TokensResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return TokensResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#TokensResult'
    public baboonTypeIdentifier() {
        return TokensResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return TokensResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return TokensResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.2.0", "prefix-compact": "1.2.0", "prefix-any-mode": "1.2.0", "identical": "1.2.0" }
    public baboonMinReaderVersions() {
        return TokensResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): TokensResult_JsonCodec {
        return TokensResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.7.0 */
export class TokensResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: TokensResult): unknown {
        if (this !== TokensResult_JsonCodec.lazyInstance.value) {
          return TokensResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "tokens": Array.from(value.tokens).map(item => ListedToken_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): TokensResult {
        if (this !== TokensResult_JsonCodec .lazyInstance.value) {
            return TokensResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new TokensResult (
            (obj["tokens"] as unknown[]).map(item => ListedToken_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return TokensResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return TokensResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#TokensResult'
    public baboonTypeIdentifier() {
        return TokensResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new TokensResult_JsonCodec())
    public static get instance(): TokensResult_JsonCodec {
        return TokensResult_JsonCodec.lazyInstance.value
    }
}