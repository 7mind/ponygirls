import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum DeliveryBoundary {
    ClientContext = "ClientContext",
    ExtensionContext = "ExtensionContext"
}

export const DeliveryBoundary_values: ReadonlyArray<DeliveryBoundary> = [
    DeliveryBoundary.ClientContext,
    DeliveryBoundary.ExtensionContext
] as const;

export function DeliveryBoundary_parse(s: string): DeliveryBoundary {
    const found = DeliveryBoundary_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown DeliveryBoundary variant: " + s);
    }
    return found;
}

export class DeliveryBoundary_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: DeliveryBoundary): unknown {
        if (this !== DeliveryBoundary_JsonCodec.lazyInstance.value) {
          return DeliveryBoundary_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): DeliveryBoundary {
        if (this !== DeliveryBoundary_JsonCodec .lazyInstance.value) {
            return DeliveryBoundary_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return DeliveryBoundary_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return DeliveryBoundary_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return DeliveryBoundary_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#DeliveryBoundary'
    public baboonTypeIdentifier() {
        return DeliveryBoundary_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new DeliveryBoundary_JsonCodec())
    public static get instance(): DeliveryBoundary_JsonCodec {
        return DeliveryBoundary_JsonCodec.lazyInstance.value
    }
}