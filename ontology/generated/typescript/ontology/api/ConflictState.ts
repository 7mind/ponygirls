import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ConflictState {
    Open = "Open",
    Resolved = "Resolved"
}

export const ConflictState_values: ReadonlyArray<ConflictState> = [
    ConflictState.Open,
    ConflictState.Resolved
] as const;

export function ConflictState_parse(s: string): ConflictState {
    const found = ConflictState_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ConflictState variant: " + s);
    }
    return found;
}

export class ConflictState_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ConflictState): unknown {
        if (this !== ConflictState_JsonCodec.lazyInstance.value) {
          return ConflictState_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ConflictState {
        if (this !== ConflictState_JsonCodec .lazyInstance.value) {
            return ConflictState_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ConflictState_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ConflictState_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ConflictState_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ConflictState'
    public baboonTypeIdentifier() {
        return ConflictState_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ConflictState_JsonCodec())
    public static get instance(): ConflictState_JsonCodec {
        return ConflictState_JsonCodec.lazyInstance.value
    }
}