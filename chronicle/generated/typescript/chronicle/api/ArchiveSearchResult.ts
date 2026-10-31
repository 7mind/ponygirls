import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ArchiveResult, ArchiveResult_JsonCodec} from './ArchiveResult.js'
import {ArchiveSearchEvidence, ArchiveSearchEvidence_JsonCodec} from './ArchiveSearchEvidence.js'

export class ArchiveSearchResult implements BaboonGeneratedLatest {
    private readonly _page: ArchiveResult;
    private readonly _evidence: Array<ArchiveSearchEvidence>;

    constructor(page: ArchiveResult, evidence: Array<ArchiveSearchEvidence>) {
        this._page = page
        this._evidence = evidence
    }

    public get page(): ArchiveResult {
        return this._page;
    }
    public get evidence(): Array<ArchiveSearchEvidence> {
        return this._evidence;
    }

    public toJSON(): Record<string, unknown> {
        return {
            page: this._page,
            evidence: this._evidence
        };
    }

    public with(overrides: {page?: ArchiveResult; evidence?: Array<ArchiveSearchEvidence>}): ArchiveSearchResult {
        return new ArchiveSearchResult(
            'page' in overrides ? overrides.page! : this._page,
            'evidence' in overrides ? overrides.evidence! : this._evidence
        );
    }

    public static fromPlain(obj: {page: ArchiveResult; evidence: Array<ArchiveSearchEvidence>}): ArchiveSearchResult {
        return new ArchiveSearchResult(
            obj.page,
            obj.evidence
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ArchiveSearchResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ArchiveSearchResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ArchiveSearchResult'
    public baboonTypeIdentifier() {
        return ArchiveSearchResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ArchiveSearchResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ArchiveSearchResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ArchiveSearchResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): ArchiveSearchResult_JsonCodec {
        return ArchiveSearchResult_JsonCodec.instance
    }
}

export class ArchiveSearchResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ArchiveSearchResult): unknown {
        if (this !== ArchiveSearchResult_JsonCodec.lazyInstance.value) {
          return ArchiveSearchResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "page": ArchiveResult_JsonCodec.instance.encode(BaboonCodecContext.Default, value.page),
            "evidence": Array.from(value.evidence).map(item => ArchiveSearchEvidence_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ArchiveSearchResult {
        if (this !== ArchiveSearchResult_JsonCodec .lazyInstance.value) {
            return ArchiveSearchResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ArchiveSearchResult (
            ArchiveResult_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["page"]),
            (obj["evidence"] as unknown[]).map(item => ArchiveSearchEvidence_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ArchiveSearchResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ArchiveSearchResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ArchiveSearchResult'
    public baboonTypeIdentifier() {
        return ArchiveSearchResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ArchiveSearchResult_JsonCodec())
    public static get instance(): ArchiveSearchResult_JsonCodec {
        return ArchiveSearchResult_JsonCodec.lazyInstance.value
    }
}