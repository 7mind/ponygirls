import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {RevisionInfo, RevisionInfo_JsonCodec} from './RevisionInfo.js'

export class HistoryResult implements BaboonGeneratedLatest {
    private readonly _revisions: Array<RevisionInfo>;

    constructor(revisions: Array<RevisionInfo>) {
        this._revisions = revisions
    }

    public get revisions(): Array<RevisionInfo> {
        return this._revisions;
    }

    public toJSON(): Record<string, unknown> {
        return {
            revisions: this._revisions
        };
    }

    public with(overrides: {revisions?: Array<RevisionInfo>}): HistoryResult {
        return new HistoryResult(
            'revisions' in overrides ? overrides.revisions! : this._revisions
        );
    }

    public static fromPlain(obj: {revisions: Array<RevisionInfo>}): HistoryResult {
        return new HistoryResult(
            obj.revisions
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return HistoryResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return HistoryResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#HistoryResult'
    public baboonTypeIdentifier() {
        return HistoryResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return HistoryResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return HistoryResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return HistoryResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): HistoryResult_JsonCodec {
        return HistoryResult_JsonCodec.instance
    }
}

export class HistoryResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: HistoryResult): unknown {
        if (this !== HistoryResult_JsonCodec.lazyInstance.value) {
          return HistoryResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "revisions": Array.from(value.revisions).map(item => RevisionInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): HistoryResult {
        if (this !== HistoryResult_JsonCodec .lazyInstance.value) {
            return HistoryResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new HistoryResult (
            (obj["revisions"] as unknown[]).map(item => RevisionInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return HistoryResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return HistoryResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#HistoryResult'
    public baboonTypeIdentifier() {
        return HistoryResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new HistoryResult_JsonCodec())
    public static get instance(): HistoryResult_JsonCodec {
        return HistoryResult_JsonCodec.lazyInstance.value
    }
}