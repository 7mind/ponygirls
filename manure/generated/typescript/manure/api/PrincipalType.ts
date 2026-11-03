import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum PrincipalType {
    Human = "Human",
    Agent = "Agent"
}

export const PrincipalType_values: ReadonlyArray<PrincipalType> = [
    PrincipalType.Human,
    PrincipalType.Agent
] as const;

export function PrincipalType_parse(s: string): PrincipalType {
    const found = PrincipalType_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown PrincipalType variant: " + s);
    }
    return found;
}

export class PrincipalType_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PrincipalType): unknown {
        if (this !== PrincipalType_JsonCodec.lazyInstance.value) {
          return PrincipalType_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PrincipalType {
        if (this !== PrincipalType_JsonCodec .lazyInstance.value) {
            return PrincipalType_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return PrincipalType_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return PrincipalType_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return PrincipalType_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#PrincipalType'
    public baboonTypeIdentifier() {
        return PrincipalType_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PrincipalType_JsonCodec())
    public static get instance(): PrincipalType_JsonCodec {
        return PrincipalType_JsonCodec.lazyInstance.value
    }
}