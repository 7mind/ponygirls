import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {SearchCountScope, SearchCountScope_JsonCodec} from './SearchCountScope.js'
import {SearchHit, SearchHit_JsonCodec} from './SearchHit.js'

export class SearchResult implements BaboonGenerated {
    private readonly _hits: Array<SearchHit>;
    private readonly _total: number;
    private readonly _countScope: SearchCountScope;
    private readonly _rankingLimit: number | undefined;

    constructor(hits: Array<SearchHit>, total: number, countScope: SearchCountScope, rankingLimit: number | undefined) {
        this._hits = hits
        this._total = total
        this._countScope = countScope
        this._rankingLimit = rankingLimit
    }

    public get hits(): Array<SearchHit> {
        return this._hits;
    }
    public get total(): number {
        return this._total;
    }
    public get countScope(): SearchCountScope {
        return this._countScope;
    }
    public get rankingLimit(): number | undefined {
        return this._rankingLimit;
    }

    public toJSON(): Record<string, unknown> {
        return {
            hits: this._hits,
            total: this._total,
            countScope: this._countScope,
            rankingLimit: this._rankingLimit !== undefined ? this._rankingLimit : undefined
        };
    }

    public with(overrides: {hits?: Array<SearchHit>; total?: number; countScope?: SearchCountScope; rankingLimit?: number | undefined}): SearchResult {
        return new SearchResult(
            'hits' in overrides ? overrides.hits! : this._hits,
            'total' in overrides ? overrides.total! : this._total,
            'countScope' in overrides ? overrides.countScope! : this._countScope,
            'rankingLimit' in overrides ? overrides.rankingLimit! : this._rankingLimit
        );
    }

    public static fromPlain(obj: {hits: Array<SearchHit>; total: number; countScope: SearchCountScope; rankingLimit: number | undefined}): SearchResult {
        return new SearchResult(
            obj.hits,
            obj.total,
            obj.countScope,
            obj.rankingLimit
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return SearchResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SearchResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SearchResult'
    public baboonTypeIdentifier() {
        return SearchResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return SearchResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return SearchResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.1.0", "identical": "1.1.0" }
    public baboonMinReaderVersions() {
        return SearchResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): SearchResult_JsonCodec {
        return SearchResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.4.0 is deprecated, you should migrate to 1.7.0 */
export class SearchResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SearchResult): unknown {
        if (this !== SearchResult_JsonCodec.lazyInstance.value) {
          return SearchResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "hits": Array.from(value.hits).map(item => SearchHit_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "total": value.total,
            "countScope": SearchCountScope_JsonCodec.instance.encode(BaboonCodecContext.Default, value.countScope),
            "rankingLimit": value.rankingLimit === undefined ? null : value.rankingLimit,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SearchResult {
        if (this !== SearchResult_JsonCodec .lazyInstance.value) {
            return SearchResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SearchResult (
            (obj["hits"] as unknown[]).map(item => SearchHit_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["total"] as number,
            SearchCountScope_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["countScope"]),
            obj["rankingLimit"] === undefined || obj["rankingLimit"] === null ? undefined : obj["rankingLimit"] === undefined || obj["rankingLimit"] === null ? undefined : obj["rankingLimit"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return SearchResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SearchResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SearchResult'
    public baboonTypeIdentifier() {
        return SearchResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SearchResult_JsonCodec())
    public static get instance(): SearchResult_JsonCodec {
        return SearchResult_JsonCodec.lazyInstance.value
    }
}