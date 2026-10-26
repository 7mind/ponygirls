import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ExpressionHintKind {
    Field = "Field",
    Value = "Value",
    Operator = "Operator"
}

export const ExpressionHintKind_values: ReadonlyArray<ExpressionHintKind> = [
    ExpressionHintKind.Field,
    ExpressionHintKind.Value,
    ExpressionHintKind.Operator
] as const;

export function ExpressionHintKind_parse(s: string): ExpressionHintKind {
    const found = ExpressionHintKind_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ExpressionHintKind variant: " + s);
    }
    return found;
}

export class ExpressionHintKind_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ExpressionHintKind): unknown {
        if (this !== ExpressionHintKind_JsonCodec.lazyInstance.value) {
          return ExpressionHintKind_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ExpressionHintKind {
        if (this !== ExpressionHintKind_JsonCodec .lazyInstance.value) {
            return ExpressionHintKind_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ExpressionHintKind_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return ExpressionHintKind_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ExpressionHintKind_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ExpressionHintKind'
    public baboonTypeIdentifier() {
        return ExpressionHintKind_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ExpressionHintKind_JsonCodec())
    public static get instance(): ExpressionHintKind_JsonCodec {
        return ExpressionHintKind_JsonCodec.lazyInstance.value
    }
}