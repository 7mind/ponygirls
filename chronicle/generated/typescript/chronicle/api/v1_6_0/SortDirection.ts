import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../../BaboonSharedRuntime.js'

export enum SortDirection {
    Asc = "Asc",
    Desc = "Desc"
}

export const SortDirection_values: ReadonlyArray<SortDirection> = [
    SortDirection.Asc,
    SortDirection.Desc
] as const;

export function SortDirection_parse(s: string): SortDirection {
    const found = SortDirection_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown SortDirection variant: " + s);
    }
    return found;
}

/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.7.0 */
export class SortDirection_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SortDirection): unknown {
        if (this !== SortDirection_JsonCodec.lazyInstance.value) {
          return SortDirection_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SortDirection {
        if (this !== SortDirection_JsonCodec .lazyInstance.value) {
            return SortDirection_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return SortDirection_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return SortDirection_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SortDirection_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SortDirection'
    public baboonTypeIdentifier() {
        return SortDirection_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SortDirection_JsonCodec())
    public static get instance(): SortDirection_JsonCodec {
        return SortDirection_JsonCodec.lazyInstance.value
    }
}