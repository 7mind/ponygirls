import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ActivityCollectorSort, ActivityCollectorSort_JsonCodec} from './ActivityCollectorSort.js'
import {SortDirection, SortDirection_JsonCodec} from './SortDirection.js'

export class ActivityQuery implements BaboonGeneratedLatest {
    private readonly _expression: string;
    private readonly _sort: ActivityCollectorSort;
    private readonly _direction: SortDirection;
    private readonly _cursor: string | undefined;
    private readonly _limit: number;

    constructor(expression: string, sort: ActivityCollectorSort, direction: SortDirection, cursor: string | undefined, limit: number) {
        this._expression = expression
        this._sort = sort
        this._direction = direction
        this._cursor = cursor
        this._limit = limit
    }

    public get expression(): string {
        return this._expression;
    }
    public get sort(): ActivityCollectorSort {
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
            expression: this._expression,
            sort: this._sort,
            direction: this._direction,
            cursor: this._cursor !== undefined ? this._cursor : undefined,
            limit: this._limit
        };
    }

    public with(overrides: {expression?: string; sort?: ActivityCollectorSort; direction?: SortDirection; cursor?: string | undefined; limit?: number}): ActivityQuery {
        return new ActivityQuery(
            'expression' in overrides ? overrides.expression! : this._expression,
            'sort' in overrides ? overrides.sort! : this._sort,
            'direction' in overrides ? overrides.direction! : this._direction,
            'cursor' in overrides ? overrides.cursor! : this._cursor,
            'limit' in overrides ? overrides.limit! : this._limit
        );
    }

    public static fromPlain(obj: {expression: string; sort: ActivityCollectorSort; direction: SortDirection; cursor: string | undefined; limit: number}): ActivityQuery {
        return new ActivityQuery(
            obj.expression,
            obj.sort,
            obj.direction,
            obj.cursor,
            obj.limit
        );
    }

    public static readonly BaboonDomainVersion = '1.8.0'
    public baboonDomainVersion() {
        return ActivityQuery.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityQuery.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityQuery'
    public baboonTypeIdentifier() {
        return ActivityQuery.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return ActivityQuery.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.8.0": "identical" }
    public baboonForwardReadable() {
        return ActivityQuery.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.3.0", "prefix-compact": "1.3.0", "prefix-any-mode": "1.3.0", "identical": "1.3.0" }
    public baboonMinReaderVersions() {
        return ActivityQuery.BaboonMinReaderVersions
    }
    public static jsonCodec(): ActivityQuery_JsonCodec {
        return ActivityQuery_JsonCodec.instance
    }
}

export class ActivityQuery_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ActivityQuery): unknown {
        if (this !== ActivityQuery_JsonCodec.lazyInstance.value) {
          return ActivityQuery_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "expression": value.expression,
            "sort": ActivityCollectorSort_JsonCodec.instance.encode(BaboonCodecContext.Default, value.sort),
            "direction": SortDirection_JsonCodec.instance.encode(BaboonCodecContext.Default, value.direction),
            "cursor": value.cursor === undefined ? null : value.cursor,
            "limit": value.limit,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ActivityQuery {
        if (this !== ActivityQuery_JsonCodec .lazyInstance.value) {
            return ActivityQuery_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ActivityQuery (
            obj["expression"] as string,
            ActivityCollectorSort_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["sort"]),
            SortDirection_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["direction"]),
            obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] as string,
            obj["limit"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.8.0'
    public baboonDomainVersion() {
        return ActivityQuery_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ActivityQuery_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ActivityQuery'
    public baboonTypeIdentifier() {
        return ActivityQuery_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ActivityQuery_JsonCodec())
    public static get instance(): ActivityQuery_JsonCodec {
        return ActivityQuery_JsonCodec.lazyInstance.value
    }
}