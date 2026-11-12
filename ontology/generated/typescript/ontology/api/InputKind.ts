import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum InputKind {
    GraphMutation = "GraphMutation",
    Capture = "Capture",
    Curation = "Curation",
    PresentationPublication = "PresentationPublication",
    Judgment = "Judgment"
}

export const InputKind_values: ReadonlyArray<InputKind> = [
    InputKind.GraphMutation,
    InputKind.Capture,
    InputKind.Curation,
    InputKind.PresentationPublication,
    InputKind.Judgment
] as const;

export function InputKind_parse(s: string): InputKind {
    const found = InputKind_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown InputKind variant: " + s);
    }
    return found;
}

export class InputKind_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: InputKind): unknown {
        if (this !== InputKind_JsonCodec.lazyInstance.value) {
          return InputKind_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): InputKind {
        if (this !== InputKind_JsonCodec .lazyInstance.value) {
            return InputKind_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return InputKind_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return InputKind_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return InputKind_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#InputKind'
    public baboonTypeIdentifier() {
        return InputKind_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new InputKind_JsonCodec())
    public static get instance(): InputKind_JsonCodec {
        return InputKind_JsonCodec.lazyInstance.value
    }
}