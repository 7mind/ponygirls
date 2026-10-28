import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {TokenInfo, TokenInfo_JsonCodec} from './TokenInfo.js'
import {TokenSource, TokenSource_JsonCodec} from './TokenSource.js'

export class ListedToken implements BaboonGenerated {
    private readonly _info: TokenInfo;
    private readonly _source: TokenSource;

    constructor(info: TokenInfo, source: TokenSource) {
        this._info = info
        this._source = source
    }

    public get info(): TokenInfo {
        return this._info;
    }
    public get source(): TokenSource {
        return this._source;
    }

    public toJSON(): Record<string, unknown> {
        return {
            info: this._info,
            source: this._source
        };
    }

    public with(overrides: {info?: TokenInfo; source?: TokenSource}): ListedToken {
        return new ListedToken(
            'info' in overrides ? overrides.info! : this._info,
            'source' in overrides ? overrides.source! : this._source
        );
    }

    public static fromPlain(obj: {info: TokenInfo; source: TokenSource}): ListedToken {
        return new ListedToken(
            obj.info,
            obj.source
        );
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return ListedToken.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ListedToken.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ListedToken'
    public baboonTypeIdentifier() {
        return ListedToken.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return ListedToken.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.2.0": "identical", "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return ListedToken.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.2.0", "prefix-compact": "1.2.0", "prefix-any-mode": "1.2.0", "identical": "1.2.0" }
    public baboonMinReaderVersions() {
        return ListedToken.BaboonMinReaderVersions
    }
    public static jsonCodec(): ListedToken_JsonCodec {
        return ListedToken_JsonCodec.instance
    }
}

/** @deprecated Version 1.2.0 is deprecated, you should migrate to 1.7.0 */
export class ListedToken_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ListedToken): unknown {
        if (this !== ListedToken_JsonCodec.lazyInstance.value) {
          return ListedToken_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "info": TokenInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.info),
            "source": TokenSource_JsonCodec.instance.encode(BaboonCodecContext.Default, value.source),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ListedToken {
        if (this !== ListedToken_JsonCodec .lazyInstance.value) {
            return ListedToken_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ListedToken (
            TokenInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["info"]),
            TokenSource_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["source"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return ListedToken_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ListedToken_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ListedToken'
    public baboonTypeIdentifier() {
        return ListedToken_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ListedToken_JsonCodec())
    public static get instance(): ListedToken_JsonCodec {
        return ListedToken_JsonCodec.lazyInstance.value
    }
}