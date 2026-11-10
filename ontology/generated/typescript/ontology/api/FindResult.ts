import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {SearchHit, SearchHit_JsonCodec} from './SearchHit.js'

export class FindResult implements BaboonGeneratedLatest {
    private readonly _generation: bigint;
    private readonly _items: Array<SearchHit>;
    private readonly _cursor: string | undefined;

    constructor(generation: bigint, items: Array<SearchHit>, cursor: string | undefined) {
        this._generation = generation
        this._items = items
        this._cursor = cursor
    }

    public get generation(): bigint {
        return this._generation;
    }
    public get items(): Array<SearchHit> {
        return this._items;
    }
    public get cursor(): string | undefined {
        return this._cursor;
    }

    public toJSON(): Record<string, unknown> {
        return {
            generation: this._generation,
            items: this._items,
            cursor: this._cursor !== undefined ? this._cursor : undefined
        };
    }

    public with(overrides: {generation?: bigint; items?: Array<SearchHit>; cursor?: string | undefined}): FindResult {
        return new FindResult(
            'generation' in overrides ? overrides.generation! : this._generation,
            'items' in overrides ? overrides.items! : this._items,
            'cursor' in overrides ? overrides.cursor! : this._cursor
        );
    }

    public static fromPlain(obj: {generation: bigint; items: Array<SearchHit>; cursor: string | undefined}): FindResult {
        return new FindResult(
            obj.generation,
            obj.items,
            obj.cursor
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return FindResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return FindResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#FindResult'
    public baboonTypeIdentifier() {
        return FindResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return FindResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return FindResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return FindResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): FindResult_JsonCodec {
        return FindResult_JsonCodec.instance
    }
}

export class FindResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: FindResult): unknown {
        if (this !== FindResult_JsonCodec.lazyInstance.value) {
          return FindResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "generation": value.generation.toString(),
            "items": Array.from(value.items).map(item => SearchHit_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "cursor": value.cursor === undefined ? null : value.cursor,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): FindResult {
        if (this !== FindResult_JsonCodec .lazyInstance.value) {
            return FindResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new FindResult (
            BaboonInt64.read(obj["generation"], "i64/u64"),
            (obj["items"] as unknown[]).map(item => SearchHit_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return FindResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return FindResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#FindResult'
    public baboonTypeIdentifier() {
        return FindResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new FindResult_JsonCodec())
    public static get instance(): FindResult_JsonCodec {
        return FindResult_JsonCodec.lazyInstance.value
    }
}