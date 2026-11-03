import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ArtifactKind {
    File = "File",
    Directory = "Directory"
}

export const ArtifactKind_values: ReadonlyArray<ArtifactKind> = [
    ArtifactKind.File,
    ArtifactKind.Directory
] as const;

export function ArtifactKind_parse(s: string): ArtifactKind {
    const found = ArtifactKind_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ArtifactKind variant: " + s);
    }
    return found;
}

export class ArtifactKind_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ArtifactKind): unknown {
        if (this !== ArtifactKind_JsonCodec.lazyInstance.value) {
          return ArtifactKind_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ArtifactKind {
        if (this !== ArtifactKind_JsonCodec .lazyInstance.value) {
            return ArtifactKind_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ArtifactKind_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ArtifactKind_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ArtifactKind_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ArtifactKind'
    public baboonTypeIdentifier() {
        return ArtifactKind_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ArtifactKind_JsonCodec())
    public static get instance(): ArtifactKind_JsonCodec {
        return ArtifactKind_JsonCodec.lazyInstance.value
    }
}