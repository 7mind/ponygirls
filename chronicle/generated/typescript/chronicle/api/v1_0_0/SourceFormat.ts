import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../../BaboonSharedRuntime.js'

export enum SourceFormat {
    Claude = "Claude",
    Codex = "Codex",
    Pi = "Pi"
}

export const SourceFormat_values: ReadonlyArray<SourceFormat> = [
    SourceFormat.Claude,
    SourceFormat.Codex,
    SourceFormat.Pi
] as const;

export function SourceFormat_parse(s: string): SourceFormat {
    const found = SourceFormat_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown SourceFormat variant: " + s);
    }
    return found;
}

/** @deprecated Version 1.0.0 is deprecated, you should migrate to 1.8.0 */
export class SourceFormat_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SourceFormat): unknown {
        if (this !== SourceFormat_JsonCodec.lazyInstance.value) {
          return SourceFormat_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SourceFormat {
        if (this !== SourceFormat_JsonCodec .lazyInstance.value) {
            return SourceFormat_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return SourceFormat_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SourceFormat_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SourceFormat_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SourceFormat'
    public baboonTypeIdentifier() {
        return SourceFormat_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SourceFormat_JsonCodec())
    public static get instance(): SourceFormat_JsonCodec {
        return SourceFormat_JsonCodec.lazyInstance.value
    }
}