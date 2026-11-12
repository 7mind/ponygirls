import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum CurationState {
    Idle = "Idle",
    Pending = "Pending",
    Running = "Running",
    Failed = "Failed",
    Stale = "Stale",
    Interrupted = "Interrupted"
}

export const CurationState_values: ReadonlyArray<CurationState> = [
    CurationState.Idle,
    CurationState.Pending,
    CurationState.Running,
    CurationState.Failed,
    CurationState.Stale,
    CurationState.Interrupted
] as const;

export function CurationState_parse(s: string): CurationState {
    const found = CurationState_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown CurationState variant: " + s);
    }
    return found;
}

export class CurationState_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationState): unknown {
        if (this !== CurationState_JsonCodec.lazyInstance.value) {
          return CurationState_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationState {
        if (this !== CurationState_JsonCodec .lazyInstance.value) {
            return CurationState_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return CurationState_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationState_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationState_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationState'
    public baboonTypeIdentifier() {
        return CurationState_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationState_JsonCodec())
    public static get instance(): CurationState_JsonCodec {
        return CurationState_JsonCodec.lazyInstance.value
    }
}