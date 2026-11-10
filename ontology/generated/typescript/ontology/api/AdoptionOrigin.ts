import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum AdoptionOrigin {
    Interpretation = "Interpretation",
    CapturedAction = "CapturedAction"
}

export const AdoptionOrigin_values: ReadonlyArray<AdoptionOrigin> = [
    AdoptionOrigin.Interpretation,
    AdoptionOrigin.CapturedAction
] as const;

export function AdoptionOrigin_parse(s: string): AdoptionOrigin {
    const found = AdoptionOrigin_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown AdoptionOrigin variant: " + s);
    }
    return found;
}

export class AdoptionOrigin_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: AdoptionOrigin): unknown {
        if (this !== AdoptionOrigin_JsonCodec.lazyInstance.value) {
          return AdoptionOrigin_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): AdoptionOrigin {
        if (this !== AdoptionOrigin_JsonCodec .lazyInstance.value) {
            return AdoptionOrigin_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return AdoptionOrigin_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return AdoptionOrigin_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return AdoptionOrigin_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#AdoptionOrigin'
    public baboonTypeIdentifier() {
        return AdoptionOrigin_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new AdoptionOrigin_JsonCodec())
    public static get instance(): AdoptionOrigin_JsonCodec {
        return AdoptionOrigin_JsonCodec.lazyInstance.value
    }
}