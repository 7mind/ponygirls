import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'

export class TokenRateWindow implements BaboonGeneratedLatest {
    private readonly _knownTokens: bigint;
    private readonly _reportedCalls: bigint;
    private readonly _unknownCalls: bigint;
    private readonly _tokensPerSecond: number | undefined;
    private readonly _sampleAgeMillis: bigint | undefined;

    constructor(knownTokens: bigint, reportedCalls: bigint, unknownCalls: bigint, tokensPerSecond: number | undefined, sampleAgeMillis: bigint | undefined) {
        this._knownTokens = knownTokens
        this._reportedCalls = reportedCalls
        this._unknownCalls = unknownCalls
        this._tokensPerSecond = tokensPerSecond
        this._sampleAgeMillis = sampleAgeMillis
    }

    public get knownTokens(): bigint {
        return this._knownTokens;
    }
    public get reportedCalls(): bigint {
        return this._reportedCalls;
    }
    public get unknownCalls(): bigint {
        return this._unknownCalls;
    }
    public get tokensPerSecond(): number | undefined {
        return this._tokensPerSecond;
    }
    public get sampleAgeMillis(): bigint | undefined {
        return this._sampleAgeMillis;
    }

    public toJSON(): Record<string, unknown> {
        return {
            knownTokens: this._knownTokens,
            reportedCalls: this._reportedCalls,
            unknownCalls: this._unknownCalls,
            tokensPerSecond: this._tokensPerSecond !== undefined ? this._tokensPerSecond : undefined,
            sampleAgeMillis: this._sampleAgeMillis !== undefined ? this._sampleAgeMillis : undefined
        };
    }

    public with(overrides: {knownTokens?: bigint; reportedCalls?: bigint; unknownCalls?: bigint; tokensPerSecond?: number | undefined; sampleAgeMillis?: bigint | undefined}): TokenRateWindow {
        return new TokenRateWindow(
            'knownTokens' in overrides ? overrides.knownTokens! : this._knownTokens,
            'reportedCalls' in overrides ? overrides.reportedCalls! : this._reportedCalls,
            'unknownCalls' in overrides ? overrides.unknownCalls! : this._unknownCalls,
            'tokensPerSecond' in overrides ? overrides.tokensPerSecond! : this._tokensPerSecond,
            'sampleAgeMillis' in overrides ? overrides.sampleAgeMillis! : this._sampleAgeMillis
        );
    }

    public static fromPlain(obj: {knownTokens: bigint; reportedCalls: bigint; unknownCalls: bigint; tokensPerSecond: number | undefined; sampleAgeMillis: bigint | undefined}): TokenRateWindow {
        return new TokenRateWindow(
            obj.knownTokens,
            obj.reportedCalls,
            obj.unknownCalls,
            obj.tokensPerSecond,
            obj.sampleAgeMillis
        );
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return TokenRateWindow.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return TokenRateWindow.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#TokenRateWindow'
    public baboonTypeIdentifier() {
        return TokenRateWindow.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return TokenRateWindow.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.7.0": "identical" }
    public baboonForwardReadable() {
        return TokenRateWindow.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return TokenRateWindow.BaboonMinReaderVersions
    }
    public static jsonCodec(): TokenRateWindow_JsonCodec {
        return TokenRateWindow_JsonCodec.instance
    }
}

export class TokenRateWindow_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: TokenRateWindow): unknown {
        if (this !== TokenRateWindow_JsonCodec.lazyInstance.value) {
          return TokenRateWindow_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "knownTokens": value.knownTokens.toString(),
            "reportedCalls": value.reportedCalls.toString(),
            "unknownCalls": value.unknownCalls.toString(),
            "tokensPerSecond": value.tokensPerSecond === undefined ? null : value.tokensPerSecond,
            "sampleAgeMillis": value.sampleAgeMillis === undefined ? null : value.sampleAgeMillis.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): TokenRateWindow {
        if (this !== TokenRateWindow_JsonCodec .lazyInstance.value) {
            return TokenRateWindow_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new TokenRateWindow (
            BaboonInt64.read(obj["knownTokens"], "i64/u64"),
            BaboonInt64.read(obj["reportedCalls"], "i64/u64"),
            BaboonInt64.read(obj["unknownCalls"], "i64/u64"),
            obj["tokensPerSecond"] === undefined || obj["tokensPerSecond"] === null ? undefined : obj["tokensPerSecond"] === undefined || obj["tokensPerSecond"] === null ? undefined : obj["tokensPerSecond"] as number,
            obj["sampleAgeMillis"] === undefined || obj["sampleAgeMillis"] === null ? undefined : obj["sampleAgeMillis"] === undefined || obj["sampleAgeMillis"] === null ? undefined : BaboonInt64.read(obj["sampleAgeMillis"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return TokenRateWindow_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return TokenRateWindow_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#TokenRateWindow'
    public baboonTypeIdentifier() {
        return TokenRateWindow_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new TokenRateWindow_JsonCodec())
    public static get instance(): TokenRateWindow_JsonCodec {
        return TokenRateWindow_JsonCodec.lazyInstance.value
    }
}