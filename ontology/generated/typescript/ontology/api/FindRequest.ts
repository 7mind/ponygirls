import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class FindRequest implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _kind: string | undefined;
    private readonly _query: string;
    private readonly _cursor: string | undefined;
    private readonly _limit: number;

    constructor(scope: string, kind: string | undefined, query: string, cursor: string | undefined, limit: number) {
        this._scope = scope
        this._kind = kind
        this._query = query
        this._cursor = cursor
        this._limit = limit
    }

    public get scope(): string {
        return this._scope;
    }
    public get kind(): string | undefined {
        return this._kind;
    }
    public get query(): string {
        return this._query;
    }
    public get cursor(): string | undefined {
        return this._cursor;
    }
    public get limit(): number {
        return this._limit;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            kind: this._kind !== undefined ? this._kind : undefined,
            query: this._query,
            cursor: this._cursor !== undefined ? this._cursor : undefined,
            limit: this._limit
        };
    }

    public with(overrides: {scope?: string; kind?: string | undefined; query?: string; cursor?: string | undefined; limit?: number}): FindRequest {
        return new FindRequest(
            'scope' in overrides ? overrides.scope! : this._scope,
            'kind' in overrides ? overrides.kind! : this._kind,
            'query' in overrides ? overrides.query! : this._query,
            'cursor' in overrides ? overrides.cursor! : this._cursor,
            'limit' in overrides ? overrides.limit! : this._limit
        );
    }

    public static fromPlain(obj: {scope: string; kind: string | undefined; query: string; cursor: string | undefined; limit: number}): FindRequest {
        return new FindRequest(
            obj.scope,
            obj.kind,
            obj.query,
            obj.cursor,
            obj.limit
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return FindRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return FindRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#FindRequest'
    public baboonTypeIdentifier() {
        return FindRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return FindRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return FindRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return FindRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): FindRequest_JsonCodec {
        return FindRequest_JsonCodec.instance
    }
}

export class FindRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: FindRequest): unknown {
        if (this !== FindRequest_JsonCodec.lazyInstance.value) {
          return FindRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "kind": value.kind === undefined ? null : value.kind,
            "query": value.query,
            "cursor": value.cursor === undefined ? null : value.cursor,
            "limit": value.limit,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): FindRequest {
        if (this !== FindRequest_JsonCodec .lazyInstance.value) {
            return FindRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new FindRequest (
            obj["scope"] as string,
            obj["kind"] === undefined || obj["kind"] === null ? undefined : obj["kind"] === undefined || obj["kind"] === null ? undefined : obj["kind"] as string,
            obj["query"] as string,
            obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] as string,
            obj["limit"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return FindRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return FindRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#FindRequest'
    public baboonTypeIdentifier() {
        return FindRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new FindRequest_JsonCodec())
    public static get instance(): FindRequest_JsonCodec {
        return FindRequest_JsonCodec.lazyInstance.value
    }
}