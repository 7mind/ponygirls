import { BaboonCodecContext, BaboonInt64, Lazy } from '../../BaboonSharedRuntime.js';
import { SearchCountScope_JsonCodec } from './SearchCountScope.js';
import { SearchHit_JsonCodec } from './SearchHit.js';
export class SearchPage {
    _hits;
    _total;
    _countScope;
    _rankingLimit;
    _nextCursor;
    constructor(hits, total, countScope, rankingLimit, nextCursor) {
        this._hits = hits;
        this._total = total;
        this._countScope = countScope;
        this._rankingLimit = rankingLimit;
        this._nextCursor = nextCursor;
    }
    get hits() {
        return this._hits;
    }
    get total() {
        return this._total;
    }
    get countScope() {
        return this._countScope;
    }
    get rankingLimit() {
        return this._rankingLimit;
    }
    get nextCursor() {
        return this._nextCursor;
    }
    toJSON() {
        return {
            hits: this._hits,
            total: this._total,
            countScope: this._countScope,
            rankingLimit: this._rankingLimit !== undefined ? this._rankingLimit : undefined,
            nextCursor: this._nextCursor !== undefined ? this._nextCursor : undefined
        };
    }
    with(overrides) {
        return new SearchPage('hits' in overrides ? overrides.hits : this._hits, 'total' in overrides ? overrides.total : this._total, 'countScope' in overrides ? overrides.countScope : this._countScope, 'rankingLimit' in overrides ? overrides.rankingLimit : this._rankingLimit, 'nextCursor' in overrides ? overrides.nextCursor : this._nextCursor);
    }
    static fromPlain(obj) {
        return new SearchPage(obj.hits, obj.total, obj.countScope, obj.rankingLimit, obj.nextCursor);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return SearchPage.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return SearchPage.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#SearchPage';
    baboonTypeIdentifier() {
        return SearchPage.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return SearchPage.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return SearchPage.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return SearchPage.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return SearchPage_JsonCodec.instance;
    }
}
export class SearchPage_JsonCodec {
    encode(ctx, value) {
        if (this !== SearchPage_JsonCodec.lazyInstance.value) {
            return SearchPage_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "hits": Array.from(value.hits).map(item => SearchHit_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "total": value.total.toString(),
            "countScope": SearchCountScope_JsonCodec.instance.encode(BaboonCodecContext.Default, value.countScope),
            "rankingLimit": value.rankingLimit === undefined ? null : value.rankingLimit,
            "nextCursor": value.nextCursor === undefined ? null : value.nextCursor,
        };
    }
    decode(ctx, json) {
        if (this !== SearchPage_JsonCodec.lazyInstance.value) {
            return SearchPage_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new SearchPage(obj["hits"].map(item => SearchHit_JsonCodec.instance.decode(BaboonCodecContext.Default, item)), BaboonInt64.read(obj["total"], "i64/u64"), SearchCountScope_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["countScope"]), obj["rankingLimit"] === undefined || obj["rankingLimit"] === null ? undefined : obj["rankingLimit"] === undefined || obj["rankingLimit"] === null ? undefined : obj["rankingLimit"], obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return SearchPage_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return SearchPage_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#SearchPage';
    baboonTypeIdentifier() {
        return SearchPage_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new SearchPage_JsonCodec());
    static get instance() {
        return SearchPage_JsonCodec.lazyInstance.value;
    }
}
