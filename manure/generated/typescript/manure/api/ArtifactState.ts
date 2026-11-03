import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ArtifactState {
    Uploading = "Uploading",
    Publishing = "Publishing",
    Ready = "Ready"
}

export const ArtifactState_values: ReadonlyArray<ArtifactState> = [
    ArtifactState.Uploading,
    ArtifactState.Publishing,
    ArtifactState.Ready
] as const;

export function ArtifactState_parse(s: string): ArtifactState {
    const found = ArtifactState_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ArtifactState variant: " + s);
    }
    return found;
}

export class ArtifactState_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ArtifactState): unknown {
        if (this !== ArtifactState_JsonCodec.lazyInstance.value) {
          return ArtifactState_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ArtifactState {
        if (this !== ArtifactState_JsonCodec .lazyInstance.value) {
            return ArtifactState_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ArtifactState_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ArtifactState_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ArtifactState_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ArtifactState'
    public baboonTypeIdentifier() {
        return ArtifactState_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ArtifactState_JsonCodec())
    public static get instance(): ArtifactState_JsonCodec {
        return ArtifactState_JsonCodec.lazyInstance.value
    }
}