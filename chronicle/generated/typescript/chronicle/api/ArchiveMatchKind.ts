import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ArchiveMatchKind {
    Literal = "Literal",
    Semantic = "Semantic"
}

export const ArchiveMatchKind_values: ReadonlyArray<ArchiveMatchKind> = [
    ArchiveMatchKind.Literal,
    ArchiveMatchKind.Semantic
] as const;

export function ArchiveMatchKind_parse(s: string): ArchiveMatchKind {
    const found = ArchiveMatchKind_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ArchiveMatchKind variant: " + s);
    }
    return found;
}

export class ArchiveMatchKind_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ArchiveMatchKind): unknown {
        if (this !== ArchiveMatchKind_JsonCodec.lazyInstance.value) {
          return ArchiveMatchKind_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ArchiveMatchKind {
        if (this !== ArchiveMatchKind_JsonCodec .lazyInstance.value) {
            return ArchiveMatchKind_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ArchiveMatchKind_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return ArchiveMatchKind_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ArchiveMatchKind_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ArchiveMatchKind'
    public baboonTypeIdentifier() {
        return ArchiveMatchKind_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ArchiveMatchKind_JsonCodec())
    public static get instance(): ArchiveMatchKind_JsonCodec {
        return ArchiveMatchKind_JsonCodec.lazyInstance.value
    }
}