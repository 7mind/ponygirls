import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {SearchSort, SearchSort_JsonCodec} from './SearchSort.js'

export class SearchRequest implements BaboonGeneratedLatest {
    private readonly _query: string;
    private readonly _project: string | undefined;
    private readonly _limit: number;
    private readonly _cursor: string | undefined;
    private readonly _sort: SearchSort;

    constructor(query: string, project: string | undefined, limit: number, cursor: string | undefined, sort: SearchSort) {
        this._query = query
        this._project = project
        this._limit = limit
        this._cursor = cursor
        this._sort = sort
    }

    public get query(): string {
        return this._query;
    }
    public get project(): string | undefined {
        return this._project;
    }
    public get limit(): number {
        return this._limit;
    }
    public get cursor(): string | undefined {
        return this._cursor;
    }
    public get sort(): SearchSort {
        return this._sort;
    }

    public toJSON(): Record<string, unknown> {
        return {
            query: this._query,
            project: this._project !== undefined ? this._project : undefined,
            limit: this._limit,
            cursor: this._cursor !== undefined ? this._cursor : undefined,
            sort: this._sort
        };
    }

    public with(overrides: {query?: string; project?: string | undefined; limit?: number; cursor?: string | undefined; sort?: SearchSort}): SearchRequest {
        return new SearchRequest(
            'query' in overrides ? overrides.query! : this._query,
            'project' in overrides ? overrides.project! : this._project,
            'limit' in overrides ? overrides.limit! : this._limit,
            'cursor' in overrides ? overrides.cursor! : this._cursor,
            'sort' in overrides ? overrides.sort! : this._sort
        );
    }

    public static fromPlain(obj: {query: string; project: string | undefined; limit: number; cursor: string | undefined; sort: SearchSort}): SearchRequest {
        return new SearchRequest(
            obj.query,
            obj.project,
            obj.limit,
            obj.cursor,
            obj.sort
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return SearchRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#SearchRequest'
    public baboonTypeIdentifier() {
        return SearchRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return SearchRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return SearchRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return SearchRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): SearchRequest_JsonCodec {
        return SearchRequest_JsonCodec.instance
    }
}

export class SearchRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SearchRequest): unknown {
        if (this !== SearchRequest_JsonCodec.lazyInstance.value) {
          return SearchRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "query": value.query,
            "project": value.project === undefined ? null : value.project,
            "limit": value.limit,
            "cursor": value.cursor === undefined ? null : value.cursor,
            "sort": SearchSort_JsonCodec.instance.encode(BaboonCodecContext.Default, value.sort),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SearchRequest {
        if (this !== SearchRequest_JsonCodec .lazyInstance.value) {
            return SearchRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SearchRequest (
            obj["query"] as string,
            obj["project"] === undefined || obj["project"] === null ? undefined : obj["project"] === undefined || obj["project"] === null ? undefined : obj["project"] as string,
            obj["limit"] as number,
            obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] as string,
            SearchSort_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["sort"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return SearchRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#SearchRequest'
    public baboonTypeIdentifier() {
        return SearchRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SearchRequest_JsonCodec())
    public static get instance(): SearchRequest_JsonCodec {
        return SearchRequest_JsonCodec.lazyInstance.value
    }
}