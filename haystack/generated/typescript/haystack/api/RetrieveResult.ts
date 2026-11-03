import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {RetrievalMode, RetrievalMode_JsonCodec} from './RetrievalMode.js'
import {RetrievedSource, RetrievedSource_JsonCodec} from './RetrievedSource.js'

export class RetrieveResult implements BaboonGeneratedLatest {
    private readonly _sources: Array<RetrievedSource>;
    private readonly _mode: RetrievalMode;
    private readonly _countScope: string;
    private readonly _total: bigint;
    private readonly _rankingLimit: number | undefined;

    constructor(sources: Array<RetrievedSource>, mode: RetrievalMode, countScope: string, total: bigint, rankingLimit: number | undefined) {
        this._sources = sources
        this._mode = mode
        this._countScope = countScope
        this._total = total
        this._rankingLimit = rankingLimit
    }

    public get sources(): Array<RetrievedSource> {
        return this._sources;
    }
    public get mode(): RetrievalMode {
        return this._mode;
    }
    public get countScope(): string {
        return this._countScope;
    }
    public get total(): bigint {
        return this._total;
    }
    public get rankingLimit(): number | undefined {
        return this._rankingLimit;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sources: this._sources,
            mode: this._mode,
            countScope: this._countScope,
            total: this._total,
            rankingLimit: this._rankingLimit !== undefined ? this._rankingLimit : undefined
        };
    }

    public with(overrides: {sources?: Array<RetrievedSource>; mode?: RetrievalMode; countScope?: string; total?: bigint; rankingLimit?: number | undefined}): RetrieveResult {
        return new RetrieveResult(
            'sources' in overrides ? overrides.sources! : this._sources,
            'mode' in overrides ? overrides.mode! : this._mode,
            'countScope' in overrides ? overrides.countScope! : this._countScope,
            'total' in overrides ? overrides.total! : this._total,
            'rankingLimit' in overrides ? overrides.rankingLimit! : this._rankingLimit
        );
    }

    public static fromPlain(obj: {sources: Array<RetrievedSource>; mode: RetrievalMode; countScope: string; total: bigint; rankingLimit: number | undefined}): RetrieveResult {
        return new RetrieveResult(
            obj.sources,
            obj.mode,
            obj.countScope,
            obj.total,
            obj.rankingLimit
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return RetrieveResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return RetrieveResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#RetrieveResult'
    public baboonTypeIdentifier() {
        return RetrieveResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return RetrieveResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return RetrieveResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return RetrieveResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): RetrieveResult_JsonCodec {
        return RetrieveResult_JsonCodec.instance
    }
}

export class RetrieveResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RetrieveResult): unknown {
        if (this !== RetrieveResult_JsonCodec.lazyInstance.value) {
          return RetrieveResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sources": Array.from(value.sources).map(item => RetrievedSource_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "mode": RetrievalMode_JsonCodec.instance.encode(BaboonCodecContext.Default, value.mode),
            "countScope": value.countScope,
            "total": value.total.toString(),
            "rankingLimit": value.rankingLimit === undefined ? null : value.rankingLimit,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RetrieveResult {
        if (this !== RetrieveResult_JsonCodec .lazyInstance.value) {
            return RetrieveResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RetrieveResult (
            (obj["sources"] as unknown[]).map(item => RetrievedSource_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            RetrievalMode_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["mode"]),
            obj["countScope"] as string,
            BaboonInt64.read(obj["total"], "i64/u64"),
            obj["rankingLimit"] === undefined || obj["rankingLimit"] === null ? undefined : obj["rankingLimit"] === undefined || obj["rankingLimit"] === null ? undefined : obj["rankingLimit"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return RetrieveResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return RetrieveResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#RetrieveResult'
    public baboonTypeIdentifier() {
        return RetrieveResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RetrieveResult_JsonCodec())
    public static get instance(): RetrieveResult_JsonCodec {
        return RetrieveResult_JsonCodec.lazyInstance.value
    }
}