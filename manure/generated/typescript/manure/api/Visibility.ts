import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Visibility {
    Internal = "Internal",
    External = "External",
    Public = "Public"
}

export const Visibility_values: ReadonlyArray<Visibility> = [
    Visibility.Internal,
    Visibility.External,
    Visibility.Public
] as const;

export function Visibility_parse(s: string): Visibility {
    const found = Visibility_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Visibility variant: " + s);
    }
    return found;
}

export class Visibility_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Visibility): unknown {
        if (this !== Visibility_JsonCodec.lazyInstance.value) {
          return Visibility_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Visibility {
        if (this !== Visibility_JsonCodec .lazyInstance.value) {
            return Visibility_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Visibility_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Visibility_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Visibility_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#Visibility'
    public baboonTypeIdentifier() {
        return Visibility_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Visibility_JsonCodec())
    public static get instance(): Visibility_JsonCodec {
        return Visibility_JsonCodec.lazyInstance.value
    }
}