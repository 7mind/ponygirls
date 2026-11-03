import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {RetrievalMode, RetrievalMode_JsonCodec} from './RetrievalMode.js'

export class RetrieveRequest implements BaboonGeneratedLatest {
    private readonly _query: string;
    private readonly _mode: RetrievalMode;
    private readonly _project: string | undefined;
    private readonly _includeArchived: boolean;
    private readonly _limit: number;

    constructor(query: string, mode: RetrievalMode, project: string | undefined, includeArchived: boolean, limit: number) {
        this._query = query
        this._mode = mode
        this._project = project
        this._includeArchived = includeArchived
        this._limit = limit
    }

    public get query(): string {
        return this._query;
    }
    public get mode(): RetrievalMode {
        return this._mode;
    }
    public get project(): string | undefined {
        return this._project;
    }
    public get includeArchived(): boolean {
        return this._includeArchived;
    }
    public get limit(): number {
        return this._limit;
    }

    public toJSON(): Record<string, unknown> {
        return {
            query: this._query,
            mode: this._mode,
            project: this._project !== undefined ? this._project : undefined,
            includeArchived: this._includeArchived,
            limit: this._limit
        };
    }

    public with(overrides: {query?: string; mode?: RetrievalMode; project?: string | undefined; includeArchived?: boolean; limit?: number}): RetrieveRequest {
        return new RetrieveRequest(
            'query' in overrides ? overrides.query! : this._query,
            'mode' in overrides ? overrides.mode! : this._mode,
            'project' in overrides ? overrides.project! : this._project,
            'includeArchived' in overrides ? overrides.includeArchived! : this._includeArchived,
            'limit' in overrides ? overrides.limit! : this._limit
        );
    }

    public static fromPlain(obj: {query: string; mode: RetrievalMode; project: string | undefined; includeArchived: boolean; limit: number}): RetrieveRequest {
        return new RetrieveRequest(
            obj.query,
            obj.mode,
            obj.project,
            obj.includeArchived,
            obj.limit
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return RetrieveRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return RetrieveRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#RetrieveRequest'
    public baboonTypeIdentifier() {
        return RetrieveRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return RetrieveRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return RetrieveRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return RetrieveRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): RetrieveRequest_JsonCodec {
        return RetrieveRequest_JsonCodec.instance
    }
}

export class RetrieveRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RetrieveRequest): unknown {
        if (this !== RetrieveRequest_JsonCodec.lazyInstance.value) {
          return RetrieveRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "query": value.query,
            "mode": RetrievalMode_JsonCodec.instance.encode(BaboonCodecContext.Default, value.mode),
            "project": value.project === undefined ? null : value.project,
            "includeArchived": value.includeArchived,
            "limit": value.limit,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RetrieveRequest {
        if (this !== RetrieveRequest_JsonCodec .lazyInstance.value) {
            return RetrieveRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RetrieveRequest (
            obj["query"] as string,
            RetrievalMode_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["mode"]),
            obj["project"] === undefined || obj["project"] === null ? undefined : obj["project"] === undefined || obj["project"] === null ? undefined : obj["project"] as string,
            obj["includeArchived"] as boolean,
            obj["limit"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return RetrieveRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return RetrieveRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#RetrieveRequest'
    public baboonTypeIdentifier() {
        return RetrieveRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RetrieveRequest_JsonCodec())
    public static get instance(): RetrieveRequest_JsonCodec {
        return RetrieveRequest_JsonCodec.lazyInstance.value
    }
}