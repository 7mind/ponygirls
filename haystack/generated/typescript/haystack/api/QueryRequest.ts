import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class QueryRequest implements BaboonGeneratedLatest {
    private readonly _query: string;
    private readonly _caret: number;

    constructor(query: string, caret: number) {
        this._query = query
        this._caret = caret
    }

    public get query(): string {
        return this._query;
    }
    public get caret(): number {
        return this._caret;
    }

    public toJSON(): Record<string, unknown> {
        return {
            query: this._query,
            caret: this._caret
        };
    }

    public with(overrides: {query?: string; caret?: number}): QueryRequest {
        return new QueryRequest(
            'query' in overrides ? overrides.query! : this._query,
            'caret' in overrides ? overrides.caret! : this._caret
        );
    }

    public static fromPlain(obj: {query: string; caret: number}): QueryRequest {
        return new QueryRequest(
            obj.query,
            obj.caret
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return QueryRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return QueryRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#QueryRequest'
    public baboonTypeIdentifier() {
        return QueryRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return QueryRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return QueryRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return QueryRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): QueryRequest_JsonCodec {
        return QueryRequest_JsonCodec.instance
    }
}

export class QueryRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: QueryRequest): unknown {
        if (this !== QueryRequest_JsonCodec.lazyInstance.value) {
          return QueryRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "query": value.query,
            "caret": value.caret,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): QueryRequest {
        if (this !== QueryRequest_JsonCodec .lazyInstance.value) {
            return QueryRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new QueryRequest (
            obj["query"] as string,
            obj["caret"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return QueryRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return QueryRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#QueryRequest'
    public baboonTypeIdentifier() {
        return QueryRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new QueryRequest_JsonCodec())
    public static get instance(): QueryRequest_JsonCodec {
        return QueryRequest_JsonCodec.lazyInstance.value
    }
}