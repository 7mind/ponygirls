import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../../BaboonSharedRuntime.js'

export enum CollectorPhase {
    Discovering = "Discovering",
    Scanning = "Scanning",
    Uploading = "Uploading",
    Idle = "Idle",
    Failed = "Failed"
}

export const CollectorPhase_values: ReadonlyArray<CollectorPhase> = [
    CollectorPhase.Discovering,
    CollectorPhase.Scanning,
    CollectorPhase.Uploading,
    CollectorPhase.Idle,
    CollectorPhase.Failed
] as const;

export function CollectorPhase_parse(s: string): CollectorPhase {
    const found = CollectorPhase_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown CollectorPhase variant: " + s);
    }
    return found;
}

/** @deprecated Version 1.7.0 is deprecated, you should migrate to 1.8.0 */
export class CollectorPhase_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CollectorPhase): unknown {
        if (this !== CollectorPhase_JsonCodec.lazyInstance.value) {
          return CollectorPhase_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CollectorPhase {
        if (this !== CollectorPhase_JsonCodec .lazyInstance.value) {
            return CollectorPhase_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return CollectorPhase_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return CollectorPhase_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return CollectorPhase_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#CollectorPhase'
    public baboonTypeIdentifier() {
        return CollectorPhase_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CollectorPhase_JsonCodec())
    public static get instance(): CollectorPhase_JsonCodec {
        return CollectorPhase_JsonCodec.lazyInstance.value
    }
}