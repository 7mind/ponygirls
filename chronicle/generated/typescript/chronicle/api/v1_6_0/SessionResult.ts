import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {Chunk, Chunk_JsonCodec} from './Chunk.js'
import {SessionInfo, SessionInfo_JsonCodec} from './SessionInfo.js'

export class SessionResult implements BaboonGenerated {
    private readonly _session: SessionInfo;
    private readonly _chunks: Array<Chunk>;

    constructor(session: SessionInfo, chunks: Array<Chunk>) {
        this._session = session
        this._chunks = chunks
    }

    public get session(): SessionInfo {
        return this._session;
    }
    public get chunks(): Array<Chunk> {
        return this._chunks;
    }

    public toJSON(): Record<string, unknown> {
        return {
            session: this._session,
            chunks: this._chunks
        };
    }

    public with(overrides: {session?: SessionInfo; chunks?: Array<Chunk>}): SessionResult {
        return new SessionResult(
            'session' in overrides ? overrides.session! : this._session,
            'chunks' in overrides ? overrides.chunks! : this._chunks
        );
    }

    public static fromPlain(obj: {session: SessionInfo; chunks: Array<Chunk>}): SessionResult {
        return new SessionResult(
            obj.session,
            obj.chunks
        );
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return SessionResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SessionResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SessionResult'
    public baboonTypeIdentifier() {
        return SessionResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return SessionResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return SessionResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return SessionResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): SessionResult_JsonCodec {
        return SessionResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.7.0 */
export class SessionResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SessionResult): unknown {
        if (this !== SessionResult_JsonCodec.lazyInstance.value) {
          return SessionResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "session": SessionInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.session),
            "chunks": Array.from(value.chunks).map(item => Chunk_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SessionResult {
        if (this !== SessionResult_JsonCodec .lazyInstance.value) {
            return SessionResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SessionResult (
            SessionInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["session"]),
            (obj["chunks"] as unknown[]).map(item => Chunk_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return SessionResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SessionResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SessionResult'
    public baboonTypeIdentifier() {
        return SessionResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SessionResult_JsonCodec())
    public static get instance(): SessionResult_JsonCodec {
        return SessionResult_JsonCodec.lazyInstance.value
    }
}