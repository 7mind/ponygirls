import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ArchiveSourceMatch, ArchiveSourceMatch_JsonCodec} from './ArchiveSourceMatch.js'

export class ArchiveSearchEvidence implements BaboonGeneratedLatest {
    private readonly _sessionId: string;
    private readonly _matches: Array<ArchiveSourceMatch>;

    constructor(sessionId: string, matches: Array<ArchiveSourceMatch>) {
        this._sessionId = sessionId
        this._matches = matches
    }

    public get sessionId(): string {
        return this._sessionId;
    }
    public get matches(): Array<ArchiveSourceMatch> {
        return this._matches;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sessionId: this._sessionId,
            matches: this._matches
        };
    }

    public with(overrides: {sessionId?: string; matches?: Array<ArchiveSourceMatch>}): ArchiveSearchEvidence {
        return new ArchiveSearchEvidence(
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId,
            'matches' in overrides ? overrides.matches! : this._matches
        );
    }

    public static fromPlain(obj: {sessionId: string; matches: Array<ArchiveSourceMatch>}): ArchiveSearchEvidence {
        return new ArchiveSearchEvidence(
            obj.sessionId,
            obj.matches
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ArchiveSearchEvidence.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ArchiveSearchEvidence.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ArchiveSearchEvidence'
    public baboonTypeIdentifier() {
        return ArchiveSearchEvidence.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ArchiveSearchEvidence.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ArchiveSearchEvidence.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ArchiveSearchEvidence.BaboonMinReaderVersions
    }
    public static jsonCodec(): ArchiveSearchEvidence_JsonCodec {
        return ArchiveSearchEvidence_JsonCodec.instance
    }
}

export class ArchiveSearchEvidence_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ArchiveSearchEvidence): unknown {
        if (this !== ArchiveSearchEvidence_JsonCodec.lazyInstance.value) {
          return ArchiveSearchEvidence_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sessionId": value.sessionId,
            "matches": Array.from(value.matches).map(item => ArchiveSourceMatch_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ArchiveSearchEvidence {
        if (this !== ArchiveSearchEvidence_JsonCodec .lazyInstance.value) {
            return ArchiveSearchEvidence_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ArchiveSearchEvidence (
            obj["sessionId"] as string,
            (obj["matches"] as unknown[]).map(item => ArchiveSourceMatch_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ArchiveSearchEvidence_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ArchiveSearchEvidence_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ArchiveSearchEvidence'
    public baboonTypeIdentifier() {
        return ArchiveSearchEvidence_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ArchiveSearchEvidence_JsonCodec())
    public static get instance(): ArchiveSearchEvidence_JsonCodec {
        return ArchiveSearchEvidence_JsonCodec.lazyInstance.value
    }
}