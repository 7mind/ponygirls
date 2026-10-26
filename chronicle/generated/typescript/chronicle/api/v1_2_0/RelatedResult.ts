import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {SearchHit, SearchHit_JsonCodec} from './SearchHit.js'

export class RelatedResult implements BaboonGenerated {
    private readonly _sessions: Array<SearchHit>;

    constructor(sessions: Array<SearchHit>) {
        this._sessions = sessions
    }

    public get sessions(): Array<SearchHit> {
        return this._sessions;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sessions: this._sessions
        };
    }

    public with(overrides: {sessions?: Array<SearchHit>}): RelatedResult {
        return new RelatedResult(
            'sessions' in overrides ? overrides.sessions! : this._sessions
        );
    }

    public static fromPlain(obj: {sessions: Array<SearchHit>}): RelatedResult {
        return new RelatedResult(
            obj.sessions
        );
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return RelatedResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RelatedResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RelatedResult'
    public baboonTypeIdentifier() {
        return RelatedResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
    public baboonSameInVersions() {
        return RelatedResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.2.0": "identical", "1.3.0": "identical" }
    public baboonForwardReadable() {
        return RelatedResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return RelatedResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): RelatedResult_JsonCodec {
        return RelatedResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.2.0 is deprecated, you should migrate to 1.3.0 */
export class RelatedResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelatedResult): unknown {
        if (this !== RelatedResult_JsonCodec.lazyInstance.value) {
          return RelatedResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sessions": Array.from(value.sessions).map(item => SearchHit_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelatedResult {
        if (this !== RelatedResult_JsonCodec .lazyInstance.value) {
            return RelatedResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RelatedResult (
            (obj["sessions"] as unknown[]).map(item => SearchHit_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return RelatedResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RelatedResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RelatedResult'
    public baboonTypeIdentifier() {
        return RelatedResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelatedResult_JsonCodec())
    public static get instance(): RelatedResult_JsonCodec {
        return RelatedResult_JsonCodec.lazyInstance.value
    }
}