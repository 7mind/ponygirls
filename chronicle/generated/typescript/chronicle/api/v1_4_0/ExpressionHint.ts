import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {ExpressionHintKind, ExpressionHintKind_JsonCodec} from './ExpressionHintKind.js'

export class ExpressionHint implements BaboonGenerated {
    private readonly _kind: ExpressionHintKind;
    private readonly _label: string;
    private readonly _insertText: string;
    private readonly _caretOffsetUtf16: number;

    constructor(kind: ExpressionHintKind, label: string, insertText: string, caretOffsetUtf16: number) {
        this._kind = kind
        this._label = label
        this._insertText = insertText
        this._caretOffsetUtf16 = caretOffsetUtf16
    }

    public get kind(): ExpressionHintKind {
        return this._kind;
    }
    public get label(): string {
        return this._label;
    }
    public get insertText(): string {
        return this._insertText;
    }
    public get caretOffsetUtf16(): number {
        return this._caretOffsetUtf16;
    }

    public toJSON(): Record<string, unknown> {
        return {
            kind: this._kind,
            label: this._label,
            insertText: this._insertText,
            caretOffsetUtf16: this._caretOffsetUtf16
        };
    }

    public with(overrides: {kind?: ExpressionHintKind; label?: string; insertText?: string; caretOffsetUtf16?: number}): ExpressionHint {
        return new ExpressionHint(
            'kind' in overrides ? overrides.kind! : this._kind,
            'label' in overrides ? overrides.label! : this._label,
            'insertText' in overrides ? overrides.insertText! : this._insertText,
            'caretOffsetUtf16' in overrides ? overrides.caretOffsetUtf16! : this._caretOffsetUtf16
        );
    }

    public static fromPlain(obj: {kind: ExpressionHintKind; label: string; insertText: string; caretOffsetUtf16: number}): ExpressionHint {
        return new ExpressionHint(
            obj.kind,
            obj.label,
            obj.insertText,
            obj.caretOffsetUtf16
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return ExpressionHint.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ExpressionHint.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ExpressionHint'
    public baboonTypeIdentifier() {
        return ExpressionHint.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return ExpressionHint.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return ExpressionHint.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return ExpressionHint.BaboonMinReaderVersions
    }
    public static jsonCodec(): ExpressionHint_JsonCodec {
        return ExpressionHint_JsonCodec.instance
    }
}

/** @deprecated Version 1.4.0 is deprecated, you should migrate to 1.7.0 */
export class ExpressionHint_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ExpressionHint): unknown {
        if (this !== ExpressionHint_JsonCodec.lazyInstance.value) {
          return ExpressionHint_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "kind": ExpressionHintKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
            "label": value.label,
            "insertText": value.insertText,
            "caretOffsetUtf16": value.caretOffsetUtf16,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ExpressionHint {
        if (this !== ExpressionHint_JsonCodec .lazyInstance.value) {
            return ExpressionHint_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ExpressionHint (
            ExpressionHintKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]),
            obj["label"] as string,
            obj["insertText"] as string,
            obj["caretOffsetUtf16"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return ExpressionHint_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ExpressionHint_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ExpressionHint'
    public baboonTypeIdentifier() {
        return ExpressionHint_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ExpressionHint_JsonCodec())
    public static get instance(): ExpressionHint_JsonCodec {
        return ExpressionHint_JsonCodec.lazyInstance.value
    }
}