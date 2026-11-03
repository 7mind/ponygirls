import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { SearchFilter_JsonCodec } from './SearchFilter.js';
import { SearchMode_JsonCodec } from './SearchMode.js';
export class SearchQuery {
    _query;
    _mode;
    _filter;
    _limit;
    _cursor;
    constructor(query, mode, filter, limit, cursor) {
        this._query = query;
        this._mode = mode;
        this._filter = filter;
        this._limit = limit;
        this._cursor = cursor;
    }
    get query() {
        return this._query;
    }
    get mode() {
        return this._mode;
    }
    get filter() {
        return this._filter;
    }
    get limit() {
        return this._limit;
    }
    get cursor() {
        return this._cursor;
    }
    toJSON() {
        return {
            query: this._query,
            mode: this._mode,
            filter: this._filter,
            limit: this._limit,
            cursor: this._cursor !== undefined ? this._cursor : undefined
        };
    }
    with(overrides) {
        return new SearchQuery('query' in overrides ? overrides.query : this._query, 'mode' in overrides ? overrides.mode : this._mode, 'filter' in overrides ? overrides.filter : this._filter, 'limit' in overrides ? overrides.limit : this._limit, 'cursor' in overrides ? overrides.cursor : this._cursor);
    }
    static fromPlain(obj) {
        return new SearchQuery(obj.query, obj.mode, obj.filter, obj.limit, obj.cursor);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return SearchQuery.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return SearchQuery.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#SearchQuery';
    baboonTypeIdentifier() {
        return SearchQuery.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return SearchQuery.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return SearchQuery.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return SearchQuery.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return SearchQuery_JsonCodec.instance;
    }
}
export class SearchQuery_JsonCodec {
    encode(ctx, value) {
        if (this !== SearchQuery_JsonCodec.lazyInstance.value) {
            return SearchQuery_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "query": value.query,
            "mode": SearchMode_JsonCodec.instance.encode(BaboonCodecContext.Default, value.mode),
            "filter": SearchFilter_JsonCodec.instance.encode(BaboonCodecContext.Default, value.filter),
            "limit": value.limit,
            "cursor": value.cursor === undefined ? null : value.cursor,
        };
    }
    decode(ctx, json) {
        if (this !== SearchQuery_JsonCodec.lazyInstance.value) {
            return SearchQuery_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new SearchQuery(obj["query"], SearchMode_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["mode"]), SearchFilter_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["filter"]), obj["limit"], obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return SearchQuery_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return SearchQuery_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#SearchQuery';
    baboonTypeIdentifier() {
        return SearchQuery_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new SearchQuery_JsonCodec());
    static get instance() {
        return SearchQuery_JsonCodec.lazyInstance.value;
    }
}
