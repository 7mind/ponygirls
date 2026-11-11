import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ArtifactState, ArtifactState_JsonCodec} from './ArtifactState.js'
import {CatalogueSort, CatalogueSort_JsonCodec} from './CatalogueSort.js'
import {SortDirection, SortDirection_JsonCodec} from './SortDirection.js'
import {Visibility, Visibility_JsonCodec} from './Visibility.js'

export class CatalogueQuery implements BaboonGeneratedLatest {
    private readonly _query: string;
    private readonly _includeExpired: boolean;
    private readonly _visibility: Visibility | undefined;
    private readonly _state: ArtifactState | undefined;
    private readonly _sort: CatalogueSort;
    private readonly _direction: SortDirection;
    private readonly _limit: number;
    private readonly _cursor: string | undefined;
    private readonly _tags: Array<string>;
    private readonly _hostname: string | undefined;
    private readonly _projectPath: string | undefined;

    constructor(query: string, includeExpired: boolean, visibility: Visibility | undefined, state: ArtifactState | undefined, sort: CatalogueSort, direction: SortDirection, limit: number, cursor: string | undefined, tags: Array<string>, hostname: string | undefined, projectPath: string | undefined) {
        this._query = query
        this._includeExpired = includeExpired
        this._visibility = visibility
        this._state = state
        this._sort = sort
        this._direction = direction
        this._limit = limit
        this._cursor = cursor
        this._tags = tags
        this._hostname = hostname
        this._projectPath = projectPath
    }

    public get query(): string {
        return this._query;
    }
    public get includeExpired(): boolean {
        return this._includeExpired;
    }
    public get visibility(): Visibility | undefined {
        return this._visibility;
    }
    public get state(): ArtifactState | undefined {
        return this._state;
    }
    public get sort(): CatalogueSort {
        return this._sort;
    }
    public get direction(): SortDirection {
        return this._direction;
    }
    public get limit(): number {
        return this._limit;
    }
    public get cursor(): string | undefined {
        return this._cursor;
    }
    public get tags(): Array<string> {
        return this._tags;
    }
    public get hostname(): string | undefined {
        return this._hostname;
    }
    public get projectPath(): string | undefined {
        return this._projectPath;
    }

    public toJSON(): Record<string, unknown> {
        return {
            query: this._query,
            includeExpired: this._includeExpired,
            visibility: this._visibility !== undefined ? this._visibility : undefined,
            state: this._state !== undefined ? this._state : undefined,
            sort: this._sort,
            direction: this._direction,
            limit: this._limit,
            cursor: this._cursor !== undefined ? this._cursor : undefined,
            tags: this._tags,
            hostname: this._hostname !== undefined ? this._hostname : undefined,
            projectPath: this._projectPath !== undefined ? this._projectPath : undefined
        };
    }

    public with(overrides: {query?: string; includeExpired?: boolean; visibility?: Visibility | undefined; state?: ArtifactState | undefined; sort?: CatalogueSort; direction?: SortDirection; limit?: number; cursor?: string | undefined; tags?: Array<string>; hostname?: string | undefined; projectPath?: string | undefined}): CatalogueQuery {
        return new CatalogueQuery(
            'query' in overrides ? overrides.query! : this._query,
            'includeExpired' in overrides ? overrides.includeExpired! : this._includeExpired,
            'visibility' in overrides ? overrides.visibility! : this._visibility,
            'state' in overrides ? overrides.state! : this._state,
            'sort' in overrides ? overrides.sort! : this._sort,
            'direction' in overrides ? overrides.direction! : this._direction,
            'limit' in overrides ? overrides.limit! : this._limit,
            'cursor' in overrides ? overrides.cursor! : this._cursor,
            'tags' in overrides ? overrides.tags! : this._tags,
            'hostname' in overrides ? overrides.hostname! : this._hostname,
            'projectPath' in overrides ? overrides.projectPath! : this._projectPath
        );
    }

    public static fromPlain(obj: {query: string; includeExpired: boolean; visibility: Visibility | undefined; state: ArtifactState | undefined; sort: CatalogueSort; direction: SortDirection; limit: number; cursor: string | undefined; tags: Array<string>; hostname: string | undefined; projectPath: string | undefined}): CatalogueQuery {
        return new CatalogueQuery(
            obj.query,
            obj.includeExpired,
            obj.visibility,
            obj.state,
            obj.sort,
            obj.direction,
            obj.limit,
            obj.cursor,
            obj.tags,
            obj.hostname,
            obj.projectPath
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return CatalogueQuery.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return CatalogueQuery.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#CatalogueQuery'
    public baboonTypeIdentifier() {
        return CatalogueQuery.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return CatalogueQuery.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return CatalogueQuery.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return CatalogueQuery.BaboonMinReaderVersions
    }
    public static jsonCodec(): CatalogueQuery_JsonCodec {
        return CatalogueQuery_JsonCodec.instance
    }
}

export class CatalogueQuery_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CatalogueQuery): unknown {
        if (this !== CatalogueQuery_JsonCodec.lazyInstance.value) {
          return CatalogueQuery_JsonCodec.lazyInstance.value.encode(ctx, value)
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
            "tags": Array.from(value.tags),
            "hostname": value.hostname === undefined ? null : value.hostname,
            "projectPath": value.projectPath === undefined ? null : value.projectPath,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CatalogueQuery {
        if (this !== CatalogueQuery_JsonCodec .lazyInstance.value) {
            return CatalogueQuery_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CatalogueQuery (
            obj["query"] as string,
            obj["includeExpired"] as boolean,
            obj["visibility"] === undefined || obj["visibility"] === null ? undefined : obj["visibility"] === undefined || obj["visibility"] === null ? undefined : Visibility_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["visibility"]),
            obj["state"] === undefined || obj["state"] === null ? undefined : obj["state"] === undefined || obj["state"] === null ? undefined : ArtifactState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]),
            CatalogueSort_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["sort"]),
            SortDirection_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["direction"]),
            obj["limit"] as number,
            obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] as string,
            (obj["tags"] as unknown[]).map(item => item as string),
            obj["hostname"] === undefined || obj["hostname"] === null ? undefined : obj["hostname"] === undefined || obj["hostname"] === null ? undefined : obj["hostname"] as string,
            obj["projectPath"] === undefined || obj["projectPath"] === null ? undefined : obj["projectPath"] === undefined || obj["projectPath"] === null ? undefined : obj["projectPath"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return CatalogueQuery_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return CatalogueQuery_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#CatalogueQuery'
    public baboonTypeIdentifier() {
        return CatalogueQuery_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CatalogueQuery_JsonCodec())
    public static get instance(): CatalogueQuery_JsonCodec {
        return CatalogueQuery_JsonCodec.lazyInstance.value
    }
}