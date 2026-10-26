import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../../BaboonSharedRuntime.js'

export enum Scope {
    Ingest = "Ingest",
    Read = "Read",
    Raw = "Raw"
}

export const Scope_values: ReadonlyArray<Scope> = [
    Scope.Ingest,
    Scope.Read,
    Scope.Raw
] as const;

export function Scope_parse(s: string): Scope {
    const found = Scope_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Scope variant: " + s);
    }
    return found;
}

/** @deprecated Version 1.0.0 is deprecated, you should migrate to 1.4.0 */
export class Scope_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Scope): unknown {
        if (this !== Scope_JsonCodec.lazyInstance.value) {
          return Scope_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Scope {
        if (this !== Scope_JsonCodec .lazyInstance.value) {
            return Scope_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Scope_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Scope_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Scope_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Scope'
    public baboonTypeIdentifier() {
        return Scope_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Scope_JsonCodec())
    public static get instance(): Scope_JsonCodec {
        return Scope_JsonCodec.lazyInstance.value
    }
}