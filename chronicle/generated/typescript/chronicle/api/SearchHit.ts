import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Chunk, Chunk_JsonCodec} from './Chunk.js'
import {SessionInfo, SessionInfo_JsonCodec} from './SessionInfo.js'

export class SearchHit implements BaboonGeneratedLatest {
    private readonly _session: SessionInfo;
    private readonly _chunks: Array<Chunk>;
    private readonly _score: number;

    constructor(session: SessionInfo, chunks: Array<Chunk>, score: number) {
        this._session = session
        this._chunks = chunks
        this._score = score
    }

    public get session(): SessionInfo {
        return this._session;
    }
    public get chunks(): Array<Chunk> {
        return this._chunks;
    }
    public get score(): number {
        return this._score;
    }

    public toJSON(): Record<string, unknown> {
        return {
            session: this._session,
            chunks: this._chunks,
            score: this._score
        };
    }

    public with(overrides: {session?: SessionInfo; chunks?: Array<Chunk>; score?: number}): SearchHit {
        return new SearchHit(
            'session' in overrides ? overrides.session! : this._session,
            'chunks' in overrides ? overrides.chunks! : this._chunks,
            'score' in overrides ? overrides.score! : this._score
        );
    }

    public static fromPlain(obj: {session: SessionInfo; chunks: Array<Chunk>; score: number}): SearchHit {
        return new SearchHit(
            obj.session,
            obj.chunks,
            obj.score
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return SearchHit.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SearchHit.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SearchHit'
    public baboonTypeIdentifier() {
        return SearchHit.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return SearchHit.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return SearchHit.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return SearchHit.BaboonMinReaderVersions
    }
    public static jsonCodec(): SearchHit_JsonCodec {
        return SearchHit_JsonCodec.instance
    }
}

export class SearchHit_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SearchHit): unknown {
        if (this !== SearchHit_JsonCodec.lazyInstance.value) {
          return SearchHit_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "session": SessionInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.session),
            "chunks": Array.from(value.chunks).map(item => Chunk_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "score": value.score,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SearchHit {
        if (this !== SearchHit_JsonCodec .lazyInstance.value) {
            return SearchHit_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SearchHit (
            SessionInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["session"]),
            (obj["chunks"] as unknown[]).map(item => Chunk_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["score"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return SearchHit_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SearchHit_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SearchHit'
    public baboonTypeIdentifier() {
        return SearchHit_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SearchHit_JsonCodec())
    public static get instance(): SearchHit_JsonCodec {
        return SearchHit_JsonCodec.lazyInstance.value
    }
}