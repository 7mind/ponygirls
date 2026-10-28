import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {ActivityJobScope, ActivityJobScope_JsonCodec} from './ActivityJobScope.js'
import {ActivityJobSort, ActivityJobSort_JsonCodec} from './ActivityJobSort.js'
import {SortDirection, SortDirection_JsonCodec} from './SortDirection.js'

export class ActivityJobsQuery implements BaboonGenerated {
    private readonly _collectorId: string | undefined;
    private readonly _scope: ActivityJobScope;
    private readonly _expression: string;
    private readonly _sort: ActivityJobSort;
    private readonly _direction: SortDirection;
    private readonly _cursor: string | undefined;
    private readonly _limit: number;

    constructor(collectorId: string | undefined, scope: ActivityJobScope, expression: string, sort: ActivityJobSort, direction: SortDirection, cursor: string | undefined, limit: number) {
        this._collectorId = collectorId
        this._scope = scope
        this._expression = expression
        this._sort = sort
        this._direction = direction
        this._cursor = cursor
        this._limit = limit
    }

    public get collectorId(): string | undefined {
        return this._collectorId;
    }
    public get scope(): ActivityJobScope {
        return this._scope;
    }
    public get expression(): string {
        return this._expression;
    }
    public get sort(): ActivityJobSort {
        return this._sort;
    }
    public get direction(): SortDirection {
        return this._direction;
    }
    public get cursor(): string | undefined {
        return this._cursor;
    }
    public get limit(): number {
        return this._limit;
    }

    public toJSON(): Record<string, unknown> {
        return {
            collectorId: this._collectorId !== undefined ? this._collectorId : undefined,
            scope: this._scope,
            expression: this._expression,
            sort: this._sort,
            direction: this._direction,
            cursor: this._cursor !== undefined ? this._cursor : undefined,
            limit: this._limit
        };
    }

    public with(overrides: {collectorId?: string | undefined; scope?: ActivityJobScope; expression?: string; sort?: ActivityJobSort; direction?: SortDirection; cursor?: string | undefined; limit?: number}): ActivityJobsQuery {
        return new ActivityJobsQuery(
            'collectorId' in overrides ? overrides.collectorId! : this._collectorId,
            'scope' in overrides ? overrides.scope! : this._scope,
            'expression' in overrides ? overrides.expression! : this._expression,
            'sort' in overrides ? overrides.sort! : this._sort,
            'direction' in overrides ? overrides.direction! : this._direction,
            'cursor' in overrides ? overrides.cursor! : this._cursor,
            'limit' in overrides ? overrides.limit! : this._limit
        );
    }

    public static fromPlain(obj: {collectorId: string | undefined; scope: ActivityJobScope; expression: string; sort: ActivityJobSort; direction: SortDirection; cursor: string | undefined; limit: number}): ActivityJobsQuery {
        return new ActivityJobsQuery(
            obj.collectorId,
            obj.scope,
            obj.expression,
            obj.sort,
            obj.direction,
            obj.cursor,
            obj.limit
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return ActivityJobsQuery.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobsQuery.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityJobsQuery'
    public baboonTypeIdentifier() {
        return ActivityJobsQuery.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return ActivityJobsQuery.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return ActivityJobsQuery.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return ActivityJobsQuery.BaboonMinReaderVersions
    }
    public static jsonCodec(): ActivityJobsQuery_JsonCodec {
        return ActivityJobsQuery_JsonCodec.instance
    }
}

/** @deprecated Version 1.3.0 is deprecated, you should migrate to 1.7.0 */
export class ActivityJobsQuery_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityJobsQuery): unknown {
        if (this !== ActivityJobsQuery_JsonCodec.lazyInstance.value) {
          return ActivityJobsQuery_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "collectorId": value.collectorId === undefined ? null : value.collectorId,
            "scope": ActivityJobScope_JsonCodec.instance.encode(BaboonCodecContext.Default, value.scope),
            "expression": value.expression,
            "sort": ActivityJobSort_JsonCodec.instance.encode(BaboonCodecContext.Default, value.sort),
            "direction": SortDirection_JsonCodec.instance.encode(BaboonCodecContext.Default, value.direction),
            "cursor": value.cursor === undefined ? null : value.cursor,
            "limit": value.limit,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityJobsQuery {
        if (this !== ActivityJobsQuery_JsonCodec .lazyInstance.value) {
            return ActivityJobsQuery_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityJobsQuery (
            obj["collectorId"] === undefined || obj["collectorId"] === null ? undefined : obj["collectorId"] === undefined || obj["collectorId"] === null ? undefined : obj["collectorId"] as string,
            ActivityJobScope_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["scope"]),
            obj["expression"] as string,
            ActivityJobSort_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["sort"]),
            SortDirection_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["direction"]),
            obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] as string,
            obj["limit"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
    public baboonDomainVersion() {
        return ActivityJobsQuery_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityJobsQuery_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityJobsQuery'
    public baboonTypeIdentifier() {
        return ActivityJobsQuery_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityJobsQuery_JsonCodec())
    public static get instance(): ActivityJobsQuery_JsonCodec {
        return ActivityJobsQuery_JsonCodec.lazyInstance.value
    }
}