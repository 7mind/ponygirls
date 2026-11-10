import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Standing {
    Active = "Active",
    Superseded = "Superseded",
    Withdrawn = "Withdrawn"
}

export const Standing_values: ReadonlyArray<Standing> = [
    Standing.Active,
    Standing.Superseded,
    Standing.Withdrawn
] as const;

export function Standing_parse(s: string): Standing {
    const found = Standing_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Standing variant: " + s);
    }
    return found;
}

export class Standing_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Standing): unknown {
        if (this !== Standing_JsonCodec.lazyInstance.value) {
          return Standing_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Standing {
        if (this !== Standing_JsonCodec .lazyInstance.value) {
            return Standing_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Standing_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Standing_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Standing_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Standing'
    public baboonTypeIdentifier() {
        return Standing_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Standing_JsonCodec())
    public static get instance(): Standing_JsonCodec {
        return Standing_JsonCodec.lazyInstance.value
    }
}