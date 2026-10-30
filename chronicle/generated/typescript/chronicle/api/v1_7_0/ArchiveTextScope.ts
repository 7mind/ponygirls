import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../../BaboonSharedRuntime.js'

export enum ArchiveTextScope {
    ExactLexical = "ExactLexical",
    BoundedCandidateSets = "BoundedCandidateSets"
}

export const ArchiveTextScope_values: ReadonlyArray<ArchiveTextScope> = [
    ArchiveTextScope.ExactLexical,
    ArchiveTextScope.BoundedCandidateSets
] as const;

export function ArchiveTextScope_parse(s: string): ArchiveTextScope {
    const found = ArchiveTextScope_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ArchiveTextScope variant: " + s);
    }
    return found;
}

/** @deprecated Version 1.7.0 is deprecated, you should migrate to 1.8.0 */
export class ArchiveTextScope_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ArchiveTextScope): unknown {
        if (this !== ArchiveTextScope_JsonCodec.lazyInstance.value) {
          return ArchiveTextScope_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ArchiveTextScope {
        if (this !== ArchiveTextScope_JsonCodec .lazyInstance.value) {
            return ArchiveTextScope_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ArchiveTextScope_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return ArchiveTextScope_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ArchiveTextScope_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ArchiveTextScope'
    public baboonTypeIdentifier() {
        return ArchiveTextScope_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ArchiveTextScope_JsonCodec())
    public static get instance(): ArchiveTextScope_JsonCodec {
        return ArchiveTextScope_JsonCodec.lazyInstance.value
    }
}