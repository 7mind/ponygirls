import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ExpressionHint, ExpressionHint_JsonCodec} from './ExpressionHint.js'

export class ExpressionHintsResult implements BaboonGeneratedLatest {
    private readonly _queryHash: string;
    private readonly _observedAt: string;
    private readonly _replaceStartUtf16: number;
    private readonly _replaceEndUtf16: number;
    private readonly _hints: Array<ExpressionHint>;
    private readonly _truncated: boolean;

    constructor(queryHash: string, observedAt: string, replaceStartUtf16: number, replaceEndUtf16: number, hints: Array<ExpressionHint>, truncated: boolean) {
        this._queryHash = queryHash
        this._observedAt = observedAt
        this._replaceStartUtf16 = replaceStartUtf16
        this._replaceEndUtf16 = replaceEndUtf16
        this._hints = hints
        this._truncated = truncated
    }

    public get queryHash(): string {
        return this._queryHash;
    }
    public get observedAt(): string {
        return this._observedAt;
    }
    public get replaceStartUtf16(): number {
        return this._replaceStartUtf16;
    }
    public get replaceEndUtf16(): number {
        return this._replaceEndUtf16;
    }
    public get hints(): Array<ExpressionHint> {
        return this._hints;
    }
    public get truncated(): boolean {
        return this._truncated;
    }

    public toJSON(): Record<string, unknown> {
        return {
            queryHash: this._queryHash,
            observedAt: this._observedAt,
            replaceStartUtf16: this._replaceStartUtf16,
            replaceEndUtf16: this._replaceEndUtf16,
            hints: this._hints,
            truncated: this._truncated
        };
    }

    public with(overrides: {queryHash?: string; observedAt?: string; replaceStartUtf16?: number; replaceEndUtf16?: number; hints?: Array<ExpressionHint>; truncated?: boolean}): ExpressionHintsResult {
        return new ExpressionHintsResult(
            'queryHash' in overrides ? overrides.queryHash! : this._queryHash,
            'observedAt' in overrides ? overrides.observedAt! : this._observedAt,
            'replaceStartUtf16' in overrides ? overrides.replaceStartUtf16! : this._replaceStartUtf16,
            'replaceEndUtf16' in overrides ? overrides.replaceEndUtf16! : this._replaceEndUtf16,
            'hints' in overrides ? overrides.hints! : this._hints,
            'truncated' in overrides ? overrides.truncated! : this._truncated
        );
    }

    public static fromPlain(obj: {queryHash: string; observedAt: string; replaceStartUtf16: number; replaceEndUtf16: number; hints: Array<ExpressionHint>; truncated: boolean}): ExpressionHintsResult {
        return new ExpressionHintsResult(
            obj.queryHash,
            obj.observedAt,
            obj.replaceStartUtf16,
            obj.replaceEndUtf16,
            obj.hints,
            obj.truncated
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ExpressionHintsResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ExpressionHintsResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ExpressionHintsResult'
    public baboonTypeIdentifier() {
        return ExpressionHintsResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return ExpressionHintsResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return ExpressionHintsResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return ExpressionHintsResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): ExpressionHintsResult_JsonCodec {
        return ExpressionHintsResult_JsonCodec.instance
    }
}

export class ExpressionHintsResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ExpressionHintsResult): unknown {
        if (this !== ExpressionHintsResult_JsonCodec.lazyInstance.value) {
          return ExpressionHintsResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "queryHash": value.queryHash,
            "observedAt": value.observedAt,
            "replaceStartUtf16": value.replaceStartUtf16,
            "replaceEndUtf16": value.replaceEndUtf16,
            "hints": Array.from(value.hints).map(item => ExpressionHint_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "truncated": value.truncated,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ExpressionHintsResult {
        if (this !== ExpressionHintsResult_JsonCodec .lazyInstance.value) {
            return ExpressionHintsResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ExpressionHintsResult (
            obj["queryHash"] as string,
            obj["observedAt"] as string,
            obj["replaceStartUtf16"] as number,
            obj["replaceEndUtf16"] as number,
            (obj["hints"] as unknown[]).map(item => ExpressionHint_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["truncated"] as boolean,
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ExpressionHintsResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ExpressionHintsResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ExpressionHintsResult'
    public baboonTypeIdentifier() {
        return ExpressionHintsResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ExpressionHintsResult_JsonCodec())
    public static get instance(): ExpressionHintsResult_JsonCodec {
        return ExpressionHintsResult_JsonCodec.lazyInstance.value
    }
}