import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class ActivityQuery implements BaboonGeneratedLatest {
    private readonly _cursor: string | undefined;
    private readonly _limit: number;

    constructor(cursor: string | undefined, limit: number) {
        this._cursor = cursor
        this._limit = limit
    }

    public get cursor(): string | undefined {
        return this._cursor;
    }
    public get limit(): number {
        return this._limit;
    }

    public toJSON(): Record<string, unknown> {
        return {
            cursor: this._cursor !== undefined ? this._cursor : undefined,
            limit: this._limit
        };
    }

    public with(overrides: {cursor?: string | undefined; limit?: number}): ActivityQuery {
        return new ActivityQuery(
            'cursor' in overrides ? overrides.cursor! : this._cursor,
            'limit' in overrides ? overrides.limit! : this._limit
        );
    }

    public static fromPlain(obj: {cursor: string | undefined; limit: number}): ActivityQuery {
        return new ActivityQuery(
            obj.cursor,
            obj.limit
        );
    }

    public static readonly BaboonDomainVersion = '1.3.0'
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
    public static readonly BaboonSameInVersions = ["1.3.0"]
    public baboonSameInVersions() {
        return ActivityQuery.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.3.0": "identical" }
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
            obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] as string,
            obj["limit"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.3.0'
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