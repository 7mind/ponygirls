import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {SearchHit, SearchHit_JsonCodec} from './SearchHit.js'

export class SearchResult implements BaboonGenerated {
    private readonly _hits: Array<SearchHit>;
    private readonly _total: number;

    constructor(hits: Array<SearchHit>, total: number) {
        this._hits = hits
        this._total = total
    }

    public get hits(): Array<SearchHit> {
        return this._hits;
    }
    public get total(): number {
        return this._total;
    }

    public toJSON(): Record<string, unknown> {
        return {
            hits: this._hits,
            total: this._total
        };
    }

    public with(overrides: {hits?: Array<SearchHit>; total?: number}): SearchResult {
        return new SearchResult(
            'hits' in overrides ? overrides.hits! : this._hits,
            'total' in overrides ? overrides.total! : this._total
        );
    }

    public static fromPlain(obj: {hits: Array<SearchHit>; total: number}): SearchResult {
        return new SearchResult(
            obj.hits,
            obj.total
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SearchResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SearchResult'
    public baboonTypeIdentifier() {
        return SearchResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return SearchResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical", "1.1.0": "prefix-compact", "1.2.0": "prefix-compact", "1.3.0": "prefix-compact", "1.4.0": "prefix-compact" }
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

/** @deprecated Version 1.0.0 is deprecated, you should migrate to 1.4.0 */
export class SearchResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SearchResult): unknown {
        if (this !== SearchResult_JsonCodec.lazyInstance.value) {
          return SearchResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "hits": Array.from(value.hits).map(item => SearchHit_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "total": value.total,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SearchResult {
        if (this !== SearchResult_JsonCodec .lazyInstance.value) {
            return SearchResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SearchResult (
            (obj["hits"] as unknown[]).map(item => SearchHit_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["total"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SearchResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SearchResult'
    public baboonTypeIdentifier() {
        return SearchResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SearchResult_JsonCodec())
    public static get instance(): SearchResult_JsonCodec {
        return SearchResult_JsonCodec.lazyInstance.value
    }
}