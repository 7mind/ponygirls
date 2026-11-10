import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Force {
    Required = "Required",
    Preferred = "Preferred",
    Unresolved = "Unresolved"
}

export const Force_values: ReadonlyArray<Force> = [
    Force.Required,
    Force.Preferred,
    Force.Unresolved
] as const;

export function Force_parse(s: string): Force {
    const found = Force_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Force variant: " + s);
    }
    return found;
}

export class Force_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Force): unknown {
        if (this !== Force_JsonCodec.lazyInstance.value) {
          return Force_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Force {
        if (this !== Force_JsonCodec .lazyInstance.value) {
            return Force_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Force_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Force_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Force_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Force'
    public baboonTypeIdentifier() {
        return Force_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Force_JsonCodec())
    public static get instance(): Force_JsonCodec {
        return Force_JsonCodec.lazyInstance.value
    }
}