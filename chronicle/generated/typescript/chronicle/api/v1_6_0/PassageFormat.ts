import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../../BaboonSharedRuntime.js'

export enum PassageFormat {
    Unindexed = "Unindexed",
    LegacyAnnotations = "LegacyAnnotations",
    ContiguousProblems = "ContiguousProblems"
}

export const PassageFormat_values: ReadonlyArray<PassageFormat> = [
    PassageFormat.Unindexed,
    PassageFormat.LegacyAnnotations,
    PassageFormat.ContiguousProblems
] as const;

export function PassageFormat_parse(s: string): PassageFormat {
    const found = PassageFormat_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown PassageFormat variant: " + s);
    }
    return found;
}

/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.7.0 */
export class PassageFormat_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PassageFormat): unknown {
        if (this !== PassageFormat_JsonCodec.lazyInstance.value) {
          return PassageFormat_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PassageFormat {
        if (this !== PassageFormat_JsonCodec .lazyInstance.value) {
            return PassageFormat_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return PassageFormat_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return PassageFormat_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return PassageFormat_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#PassageFormat'
    public baboonTypeIdentifier() {
        return PassageFormat_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PassageFormat_JsonCodec())
    public static get instance(): PassageFormat_JsonCodec {
        return PassageFormat_JsonCodec.lazyInstance.value
    }
}