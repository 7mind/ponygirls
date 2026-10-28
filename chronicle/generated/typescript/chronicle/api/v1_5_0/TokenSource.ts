import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../../BaboonSharedRuntime.js'

export enum TokenSource {
    Issued = "Issued",
    StaticConfig = "StaticConfig"
}

export const TokenSource_values: ReadonlyArray<TokenSource> = [
    TokenSource.Issued,
    TokenSource.StaticConfig
] as const;

export function TokenSource_parse(s: string): TokenSource {
    const found = TokenSource_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown TokenSource variant: " + s);
    }
    return found;
}

/** @deprecated Version 1.5.0 is deprecated, you should migrate to 1.7.0 */
export class TokenSource_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: TokenSource): unknown {
        if (this !== TokenSource_JsonCodec.lazyInstance.value) {
          return TokenSource_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): TokenSource {
        if (this !== TokenSource_JsonCodec .lazyInstance.value) {
            return TokenSource_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return TokenSource_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return TokenSource_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return TokenSource_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#TokenSource'
    public baboonTypeIdentifier() {
        return TokenSource_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new TokenSource_JsonCodec())
    public static get instance(): TokenSource_JsonCodec {
        return TokenSource_JsonCodec.lazyInstance.value
    }
}