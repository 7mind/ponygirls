import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum RefreshHealth {
    Healthy = "Healthy",
    Due = "Due",
    Uncertain = "Uncertain",
    Failed = "Failed"
}

export const RefreshHealth_values: ReadonlyArray<RefreshHealth> = [
    RefreshHealth.Healthy,
    RefreshHealth.Due,
    RefreshHealth.Uncertain,
    RefreshHealth.Failed
] as const;

export function RefreshHealth_parse(s: string): RefreshHealth {
    const found = RefreshHealth_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown RefreshHealth variant: " + s);
    }
    return found;
}

export class RefreshHealth_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RefreshHealth): unknown {
        if (this !== RefreshHealth_JsonCodec.lazyInstance.value) {
          return RefreshHealth_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RefreshHealth {
        if (this !== RefreshHealth_JsonCodec .lazyInstance.value) {
            return RefreshHealth_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return RefreshHealth_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return RefreshHealth_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return RefreshHealth_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#RefreshHealth'
    public baboonTypeIdentifier() {
        return RefreshHealth_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RefreshHealth_JsonCodec())
    public static get instance(): RefreshHealth_JsonCodec {
        return RefreshHealth_JsonCodec.lazyInstance.value
    }
}