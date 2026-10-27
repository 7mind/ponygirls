import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {ExpressionHintTarget, ExpressionHintTarget_JsonCodec} from './ExpressionHintTarget.js'

export class ExpressionHintQuery implements BaboonGenerated {
    private readonly _target: ExpressionHintTarget;
    private readonly _expression: string;
    private readonly _caretUtf16: number;
    private readonly _limit: number;

    constructor(target: ExpressionHintTarget, expression: string, caretUtf16: number, limit: number) {
        this._target = target
        this._expression = expression
        this._caretUtf16 = caretUtf16
        this._limit = limit
    }

    public get target(): ExpressionHintTarget {
        return this._target;
    }
    public get expression(): string {
        return this._expression;
    }
    public get caretUtf16(): number {
        return this._caretUtf16;
    }
    public get limit(): number {
        return this._limit;
    }

    public toJSON(): Record<string, unknown> {
        return {
            target: this._target,
            expression: this._expression,
            caretUtf16: this._caretUtf16,
            limit: this._limit
        };
    }

    public with(overrides: {target?: ExpressionHintTarget; expression?: string; caretUtf16?: number; limit?: number}): ExpressionHintQuery {
        return new ExpressionHintQuery(
            'target' in overrides ? overrides.target! : this._target,
            'expression' in overrides ? overrides.expression! : this._expression,
            'caretUtf16' in overrides ? overrides.caretUtf16! : this._caretUtf16,
            'limit' in overrides ? overrides.limit! : this._limit
        );
    }

    public static fromPlain(obj: {target: ExpressionHintTarget; expression: string; caretUtf16: number; limit: number}): ExpressionHintQuery {
        return new ExpressionHintQuery(
            obj.target,
            obj.expression,
            obj.caretUtf16,
            obj.limit
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return ExpressionHintQuery.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ExpressionHintQuery.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ExpressionHintQuery'
    public baboonTypeIdentifier() {
        return ExpressionHintQuery.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0"]
    public baboonSameInVersions() {
        return ExpressionHintQuery.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical", "1.5.0": "identical" }
    public baboonForwardReadable() {
        return ExpressionHintQuery.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return ExpressionHintQuery.BaboonMinReaderVersions
    }
    public static jsonCodec(): ExpressionHintQuery_JsonCodec {
        return ExpressionHintQuery_JsonCodec.instance
    }
}

/** @deprecated Version 1.4.0 is deprecated, you should migrate to 1.5.0 */
export class ExpressionHintQuery_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ExpressionHintQuery): unknown {
        if (this !== ExpressionHintQuery_JsonCodec.lazyInstance.value) {
          return ExpressionHintQuery_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "target": ExpressionHintTarget_JsonCodec.instance.encode(BaboonCodecContext.Default, value.target),
            "expression": value.expression,
            "caretUtf16": value.caretUtf16,
            "limit": value.limit,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ExpressionHintQuery {
        if (this !== ExpressionHintQuery_JsonCodec .lazyInstance.value) {
            return ExpressionHintQuery_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ExpressionHintQuery (
            ExpressionHintTarget_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["target"]),
            obj["expression"] as string,
            obj["caretUtf16"] as number,
            obj["limit"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return ExpressionHintQuery_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ExpressionHintQuery_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ExpressionHintQuery'
    public baboonTypeIdentifier() {
        return ExpressionHintQuery_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ExpressionHintQuery_JsonCodec())
    public static get instance(): ExpressionHintQuery_JsonCodec {
        return ExpressionHintQuery_JsonCodec.lazyInstance.value
    }
}