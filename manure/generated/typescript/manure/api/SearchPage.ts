import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {SearchCountScope, SearchCountScope_JsonCodec} from './SearchCountScope.js'
import {SearchHit, SearchHit_JsonCodec} from './SearchHit.js'

export class SearchPage implements BaboonGeneratedLatest {
    private readonly _hits: Array<SearchHit>;
    private readonly _total: bigint;
    private readonly _countScope: SearchCountScope;
    private readonly _rankingLimit: number | undefined;
    private readonly _nextCursor: string | undefined;

    constructor(hits: Array<SearchHit>, total: bigint, countScope: SearchCountScope, rankingLimit: number | undefined, nextCursor: string | undefined) {
        this._hits = hits
        this._total = total
        this._countScope = countScope
        this._rankingLimit = rankingLimit
        this._nextCursor = nextCursor
    }

    public get hits(): Array<SearchHit> {
        return this._hits;
    }
    public get total(): bigint {
        return this._total;
    }
    public get countScope(): SearchCountScope {
        return this._countScope;
    }
    public get rankingLimit(): number | undefined {
        return this._rankingLimit;
    }
    public get nextCursor(): string | undefined {
        return this._nextCursor;
    }

    public toJSON(): Record<string, unknown> {
        return {
            hits: this._hits,
            total: this._total,
            countScope: this._countScope,
            rankingLimit: this._rankingLimit !== undefined ? this._rankingLimit : undefined,
            nextCursor: this._nextCursor !== undefined ? this._nextCursor : undefined
        };
    }

    public with(overrides: {hits?: Array<SearchHit>; total?: bigint; countScope?: SearchCountScope; rankingLimit?: number | undefined; nextCursor?: string | undefined}): SearchPage {
        return new SearchPage(
            'hits' in overrides ? overrides.hits! : this._hits,
            'total' in overrides ? overrides.total! : this._total,
            'countScope' in overrides ? overrides.countScope! : this._countScope,
            'rankingLimit' in overrides ? overrides.rankingLimit! : this._rankingLimit,
            'nextCursor' in overrides ? overrides.nextCursor! : this._nextCursor
        );
    }

    public static fromPlain(obj: {hits: Array<SearchHit>; total: bigint; countScope: SearchCountScope; rankingLimit: number | undefined; nextCursor: string | undefined}): SearchPage {
        return new SearchPage(
            obj.hits,
            obj.total,
            obj.countScope,
            obj.rankingLimit,
            obj.nextCursor
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchPage.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return SearchPage.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#SearchPage'
    public baboonTypeIdentifier() {
        return SearchPage.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return SearchPage.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return SearchPage.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return SearchPage.BaboonMinReaderVersions
    }
    public static jsonCodec(): SearchPage_JsonCodec {
        return SearchPage_JsonCodec.instance
    }
}

export class SearchPage_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SearchPage): unknown {
        if (this !== SearchPage_JsonCodec.lazyInstance.value) {
          return SearchPage_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "hits": Array.from(value.hits).map(item => SearchHit_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "total": value.total.toString(),
            "countScope": SearchCountScope_JsonCodec.instance.encode(BaboonCodecContext.Default, value.countScope),
            "rankingLimit": value.rankingLimit === undefined ? null : value.rankingLimit,
            "nextCursor": value.nextCursor === undefined ? null : value.nextCursor,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SearchPage {
        if (this !== SearchPage_JsonCodec .lazyInstance.value) {
            return SearchPage_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SearchPage (
            (obj["hits"] as unknown[]).map(item => SearchHit_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            BaboonInt64.read(obj["total"], "i64/u64"),
            SearchCountScope_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["countScope"]),
            obj["rankingLimit"] === undefined || obj["rankingLimit"] === null ? undefined : obj["rankingLimit"] === undefined || obj["rankingLimit"] === null ? undefined : obj["rankingLimit"] as number,
            obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchPage_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return SearchPage_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#SearchPage'
    public baboonTypeIdentifier() {
        return SearchPage_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SearchPage_JsonCodec())
    public static get instance(): SearchPage_JsonCodec {
        return SearchPage_JsonCodec.lazyInstance.value
    }
}