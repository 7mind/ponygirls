import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Summary, Summary_JsonCodec} from './Summary.js'

export class SearchResult implements BaboonGeneratedLatest {
    private readonly _items: Array<Summary>;
    private readonly _cursor: string | undefined;

    constructor(items: Array<Summary>, cursor: string | undefined) {
        this._items = items
        this._cursor = cursor
    }

    public get items(): Array<Summary> {
        return this._items;
    }
    public get cursor(): string | undefined {
        return this._cursor;
    }

    public toJSON(): Record<string, unknown> {
        return {
            items: this._items,
            cursor: this._cursor !== undefined ? this._cursor : undefined
        };
    }

    public with(overrides: {items?: Array<Summary>; cursor?: string | undefined}): SearchResult {
        return new SearchResult(
            'items' in overrides ? overrides.items! : this._items,
            'cursor' in overrides ? overrides.cursor! : this._cursor
        );
    }

    public static fromPlain(obj: {items: Array<Summary>; cursor: string | undefined}): SearchResult {
        return new SearchResult(
            obj.items,
            obj.cursor
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return SearchResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#SearchResult'
    public baboonTypeIdentifier() {
        return SearchResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return SearchResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return SearchResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return SearchResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): SearchResult_JsonCodec {
        return SearchResult_JsonCodec.instance
    }
}

export class SearchResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SearchResult): unknown {
        if (this !== SearchResult_JsonCodec.lazyInstance.value) {
          return SearchResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "items": Array.from(value.items).map(item => Summary_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "cursor": value.cursor === undefined ? null : value.cursor,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SearchResult {
        if (this !== SearchResult_JsonCodec .lazyInstance.value) {
            return SearchResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SearchResult (
            (obj["items"] as unknown[]).map(item => Summary_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return SearchResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#SearchResult'
    public baboonTypeIdentifier() {
        return SearchResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SearchResult_JsonCodec())
    public static get instance(): SearchResult_JsonCodec {
        return SearchResult_JsonCodec.lazyInstance.value
    }
}