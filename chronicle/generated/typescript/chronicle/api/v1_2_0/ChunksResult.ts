import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {Chunk, Chunk_JsonCodec} from './Chunk.js'
import {ContentView, ContentView_JsonCodec} from './ContentView.js'

export class ChunksResult implements BaboonGenerated {
    private readonly _chunks: Array<Chunk>;
    private readonly _total: number;
    private readonly _offset: number;
    private readonly _view: ContentView;

    constructor(chunks: Array<Chunk>, total: number, offset: number, view: ContentView) {
        this._chunks = chunks
        this._total = total
        this._offset = offset
        this._view = view
    }

    public get chunks(): Array<Chunk> {
        return this._chunks;
    }
    public get total(): number {
        return this._total;
    }
    public get offset(): number {
        return this._offset;
    }
    public get view(): ContentView {
        return this._view;
    }

    public toJSON(): Record<string, unknown> {
        return {
            chunks: this._chunks,
            total: this._total,
            offset: this._offset,
            view: this._view
        };
    }

    public with(overrides: {chunks?: Array<Chunk>; total?: number; offset?: number; view?: ContentView}): ChunksResult {
        return new ChunksResult(
            'chunks' in overrides ? overrides.chunks! : this._chunks,
            'total' in overrides ? overrides.total! : this._total,
            'offset' in overrides ? overrides.offset! : this._offset,
            'view' in overrides ? overrides.view! : this._view
        );
    }

    public static fromPlain(obj: {chunks: Array<Chunk>; total: number; offset: number; view: ContentView}): ChunksResult {
        return new ChunksResult(
            obj.chunks,
            obj.total,
            obj.offset,
            obj.view
        );
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return ChunksResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ChunksResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ChunksResult'
    public baboonTypeIdentifier() {
        return ChunksResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return ChunksResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.2.0": "identical", "1.3.0": "identical" }
    public baboonForwardReadable() {
        return ChunksResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ChunksResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): ChunksResult_JsonCodec {
        return ChunksResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.2.0 is deprecated, you should migrate to 1.3.0 */
export class ChunksResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ChunksResult): unknown {
        if (this !== ChunksResult_JsonCodec.lazyInstance.value) {
          return ChunksResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "chunks": Array.from(value.chunks).map(item => Chunk_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "total": value.total,
            "offset": value.offset,
            "view": ContentView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.view),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ChunksResult {
        if (this !== ChunksResult_JsonCodec .lazyInstance.value) {
            return ChunksResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ChunksResult (
            (obj["chunks"] as unknown[]).map(item => Chunk_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["total"] as number,
            obj["offset"] as number,
            ContentView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["view"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return ChunksResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ChunksResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ChunksResult'
    public baboonTypeIdentifier() {
        return ChunksResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ChunksResult_JsonCodec())
    public static get instance(): ChunksResult_JsonCodec {
        return ChunksResult_JsonCodec.lazyInstance.value
    }
}