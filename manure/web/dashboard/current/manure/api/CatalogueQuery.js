import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { ArtifactState_JsonCodec } from './ArtifactState.js';
import { CatalogueSort_JsonCodec } from './CatalogueSort.js';
import { SortDirection_JsonCodec } from './SortDirection.js';
import { Visibility_JsonCodec } from './Visibility.js';
export class CatalogueQuery {
    _query;
    _includeExpired;
    _visibility;
    _state;
    _sort;
    _direction;
    _limit;
    _cursor;
    constructor(query, includeExpired, visibility, state, sort, direction, limit, cursor) {
        this._query = query;
        this._includeExpired = includeExpired;
        this._visibility = visibility;
        this._state = state;
        this._sort = sort;
        this._direction = direction;
        this._limit = limit;
        this._cursor = cursor;
    }
    get query() {
        return this._query;
    }
    get includeExpired() {
        return this._includeExpired;
    }
    get visibility() {
        return this._visibility;
    }
    get state() {
        return this._state;
    }
    get sort() {
        return this._sort;
    }
    get direction() {
        return this._direction;
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
            includeExpired: this._includeExpired,
            visibility: this._visibility !== undefined ? this._visibility : undefined,
            state: this._state !== undefined ? this._state : undefined,
            sort: this._sort,
            direction: this._direction,
            limit: this._limit,
            cursor: this._cursor !== undefined ? this._cursor : undefined
        };
    }
    with(overrides) {
        return new CatalogueQuery('query' in overrides ? overrides.query : this._query, 'includeExpired' in overrides ? overrides.includeExpired : this._includeExpired, 'visibility' in overrides ? overrides.visibility : this._visibility, 'state' in overrides ? overrides.state : this._state, 'sort' in overrides ? overrides.sort : this._sort, 'direction' in overrides ? overrides.direction : this._direction, 'limit' in overrides ? overrides.limit : this._limit, 'cursor' in overrides ? overrides.cursor : this._cursor);
    }
    static fromPlain(obj) {
        return new CatalogueQuery(obj.query, obj.includeExpired, obj.visibility, obj.state, obj.sort, obj.direction, obj.limit, obj.cursor);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return CatalogueQuery.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return CatalogueQuery.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#CatalogueQuery';
    baboonTypeIdentifier() {
        return CatalogueQuery.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return CatalogueQuery.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return CatalogueQuery.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return CatalogueQuery.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return CatalogueQuery_JsonCodec.instance;
    }
}
export class CatalogueQuery_JsonCodec {
    encode(ctx, value) {
        if (this !== CatalogueQuery_JsonCodec.lazyInstance.value) {
            return CatalogueQuery_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "query": value.query,
            "includeExpired": value.includeExpired,
            "visibility": value.visibility === undefined ? null : Visibility_JsonCodec.instance.encode(BaboonCodecContext.Default, value.visibility),
            "state": value.state === undefined ? null : ArtifactState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.state),
            "sort": CatalogueSort_JsonCodec.instance.encode(BaboonCodecContext.Default, value.sort),
            "direction": SortDirection_JsonCodec.instance.encode(BaboonCodecContext.Default, value.direction),
            "limit": value.limit,
            "cursor": value.cursor === undefined ? null : value.cursor,
        };
    }
    decode(ctx, json) {
        if (this !== CatalogueQuery_JsonCodec.lazyInstance.value) {
            return CatalogueQuery_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new CatalogueQuery(obj["query"], obj["includeExpired"], obj["visibility"] === undefined || obj["visibility"] === null ? undefined : obj["visibility"] === undefined || obj["visibility"] === null ? undefined : Visibility_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["visibility"]), obj["state"] === undefined || obj["state"] === null ? undefined : obj["state"] === undefined || obj["state"] === null ? undefined : ArtifactState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]), CatalogueSort_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["sort"]), SortDirection_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["direction"]), obj["limit"], obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return CatalogueQuery_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return CatalogueQuery_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#CatalogueQuery';
    baboonTypeIdentifier() {
        return CatalogueQuery_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new CatalogueQuery_JsonCodec());
    static get instance() {
        return CatalogueQuery_JsonCodec.lazyInstance.value;
    }
}
