import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {SearchFilter, SearchFilter_JsonCodec} from './SearchFilter.js'
import {SearchMode, SearchMode_JsonCodec} from './SearchMode.js'

export class SearchQuery implements BaboonGenerated {
    private readonly _query: string;
    private readonly _mode: SearchMode;
    private readonly _filter: SearchFilter;
    private readonly _limit: number;
    private readonly _offset: number;

    constructor(query: string, mode: SearchMode, filter: SearchFilter, limit: number, offset: number) {
        this._query = query
        this._mode = mode
        this._filter = filter
        this._limit = limit
        this._offset = offset
    }

    public get query(): string {
        return this._query;
    }
    public get mode(): SearchMode {
        return this._mode;
    }
    public get filter(): SearchFilter {
        return this._filter;
    }
    public get limit(): number {
        return this._limit;
    }
    public get offset(): number {
        return this._offset;
    }

    public toJSON(): Record<string, unknown> {
        return {
            query: this._query,
            mode: this._mode,
            filter: this._filter,
            limit: this._limit,
            offset: this._offset
        };
    }

    public with(overrides: {query?: string; mode?: SearchMode; filter?: SearchFilter; limit?: number; offset?: number}): SearchQuery {
        return new SearchQuery(
            'query' in overrides ? overrides.query! : this._query,
            'mode' in overrides ? overrides.mode! : this._mode,
            'filter' in overrides ? overrides.filter! : this._filter,
            'limit' in overrides ? overrides.limit! : this._limit,
            'offset' in overrides ? overrides.offset! : this._offset
        );
    }

    public static fromPlain(obj: {query: string; mode: SearchMode; filter: SearchFilter; limit: number; offset: number}): SearchQuery {
        return new SearchQuery(
            obj.query,
            obj.mode,
            obj.filter,
            obj.limit,
            obj.offset
        );
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return SearchQuery.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SearchQuery.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SearchQuery'
    public baboonTypeIdentifier() {
        return SearchQuery.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return SearchQuery.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.2.0": "identical", "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return SearchQuery.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return SearchQuery.BaboonMinReaderVersions
    }
    public static jsonCodec(): SearchQuery_JsonCodec {
        return SearchQuery_JsonCodec.instance
    }
}

/** @deprecated Version 1.2.0 is deprecated, you should migrate to 1.8.0 */
export class SearchQuery_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SearchQuery): unknown {
        if (this !== SearchQuery_JsonCodec.lazyInstance.value) {
          return SearchQuery_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "query": value.query,
            "mode": SearchMode_JsonCodec.instance.encode(BaboonCodecContext.Default, value.mode),
            "filter": SearchFilter_JsonCodec.instance.encode(BaboonCodecContext.Default, value.filter),
            "limit": value.limit,
            "offset": value.offset,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SearchQuery {
        if (this !== SearchQuery_JsonCodec .lazyInstance.value) {
            return SearchQuery_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SearchQuery (
            obj["query"] as string,
            SearchMode_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["mode"]),
            SearchFilter_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["filter"]),
            obj["limit"] as number,
            obj["offset"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return SearchQuery_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SearchQuery_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SearchQuery'
    public baboonTypeIdentifier() {
        return SearchQuery_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SearchQuery_JsonCodec())
    public static get instance(): SearchQuery_JsonCodec {
        return SearchQuery_JsonCodec.lazyInstance.value
    }
}