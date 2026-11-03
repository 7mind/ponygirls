import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Span, Span_JsonCodec} from './Span.js'

export class AnalyzeResult implements BaboonGeneratedLatest {
    private readonly _valid: boolean;
    private readonly _spans: Array<Span>;

    constructor(valid: boolean, spans: Array<Span>) {
        this._valid = valid
        this._spans = spans
    }

    public get valid(): boolean {
        return this._valid;
    }
    public get spans(): Array<Span> {
        return this._spans;
    }

    public toJSON(): Record<string, unknown> {
        return {
            valid: this._valid,
            spans: this._spans
        };
    }

    public with(overrides: {valid?: boolean; spans?: Array<Span>}): AnalyzeResult {
        return new AnalyzeResult(
            'valid' in overrides ? overrides.valid! : this._valid,
            'spans' in overrides ? overrides.spans! : this._spans
        );
    }

    public static fromPlain(obj: {valid: boolean; spans: Array<Span>}): AnalyzeResult {
        return new AnalyzeResult(
            obj.valid,
            obj.spans
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return AnalyzeResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return AnalyzeResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#AnalyzeResult'
    public baboonTypeIdentifier() {
        return AnalyzeResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return AnalyzeResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return AnalyzeResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return AnalyzeResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): AnalyzeResult_JsonCodec {
        return AnalyzeResult_JsonCodec.instance
    }
}

export class AnalyzeResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: AnalyzeResult): unknown {
        if (this !== AnalyzeResult_JsonCodec.lazyInstance.value) {
          return AnalyzeResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "valid": value.valid,
            "spans": Array.from(value.spans).map(item => Span_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): AnalyzeResult {
        if (this !== AnalyzeResult_JsonCodec .lazyInstance.value) {
            return AnalyzeResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new AnalyzeResult (
            obj["valid"] as boolean,
            (obj["spans"] as unknown[]).map(item => Span_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return AnalyzeResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return AnalyzeResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#AnalyzeResult'
    public baboonTypeIdentifier() {
        return AnalyzeResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new AnalyzeResult_JsonCodec())
    public static get instance(): AnalyzeResult_JsonCodec {
        return AnalyzeResult_JsonCodec.lazyInstance.value
    }
}