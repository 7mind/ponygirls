import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum Assessment {
    Unassessed = "Unassessed",
    Supported = "Supported",
    Contradicted = "Contradicted",
    Mixed = "Mixed"
}

export const Assessment_values: ReadonlyArray<Assessment> = [
    Assessment.Unassessed,
    Assessment.Supported,
    Assessment.Contradicted,
    Assessment.Mixed
] as const;

export function Assessment_parse(s: string): Assessment {
    const found = Assessment_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown Assessment variant: " + s);
    }
    return found;
}

export class Assessment_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Assessment): unknown {
        if (this !== Assessment_JsonCodec.lazyInstance.value) {
          return Assessment_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Assessment {
        if (this !== Assessment_JsonCodec .lazyInstance.value) {
            return Assessment_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return Assessment_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Assessment_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Assessment_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Assessment'
    public baboonTypeIdentifier() {
        return Assessment_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Assessment_JsonCodec())
    public static get instance(): Assessment_JsonCodec {
        return Assessment_JsonCodec.lazyInstance.value
    }
}