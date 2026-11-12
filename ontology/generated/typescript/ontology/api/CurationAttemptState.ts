import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum CurationAttemptState {
    Claimed = "Claimed",
    InputSealed = "InputSealed",
    Running = "Running",
    Published = "Published",
    Failed = "Failed",
    Stale = "Stale",
    Interrupted = "Interrupted"
}

export const CurationAttemptState_values: ReadonlyArray<CurationAttemptState> = [
    CurationAttemptState.Claimed,
    CurationAttemptState.InputSealed,
    CurationAttemptState.Running,
    CurationAttemptState.Published,
    CurationAttemptState.Failed,
    CurationAttemptState.Stale,
    CurationAttemptState.Interrupted
] as const;

export function CurationAttemptState_parse(s: string): CurationAttemptState {
    const found = CurationAttemptState_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown CurationAttemptState variant: " + s);
    }
    return found;
}

export class CurationAttemptState_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationAttemptState): unknown {
        if (this !== CurationAttemptState_JsonCodec.lazyInstance.value) {
          return CurationAttemptState_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationAttemptState {
        if (this !== CurationAttemptState_JsonCodec .lazyInstance.value) {
            return CurationAttemptState_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return CurationAttemptState_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationAttemptState_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationAttemptState_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationAttemptState'
    public baboonTypeIdentifier() {
        return CurationAttemptState_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationAttemptState_JsonCodec())
    public static get instance(): CurationAttemptState_JsonCodec {
        return CurationAttemptState_JsonCodec.lazyInstance.value
    }
}