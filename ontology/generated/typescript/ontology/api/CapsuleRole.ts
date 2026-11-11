import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum CapsuleRole {
    RecordAccount = "RecordAccount",
    IntentAccount = "IntentAccount",
    HumanBasisAccount = "HumanBasisAccount",
    DerivedAccount = "DerivedAccount",
    Observation = "Observation",
    Binding = "Binding",
    Selection = "Selection",
    Progress = "Progress",
    Relation = "Relation",
    SourceBasis = "SourceBasis",
    Artifact = "Artifact",
    Attribution = "Attribution"
}

export const CapsuleRole_values: ReadonlyArray<CapsuleRole> = [
    CapsuleRole.RecordAccount,
    CapsuleRole.IntentAccount,
    CapsuleRole.HumanBasisAccount,
    CapsuleRole.DerivedAccount,
    CapsuleRole.Observation,
    CapsuleRole.Binding,
    CapsuleRole.Selection,
    CapsuleRole.Progress,
    CapsuleRole.Relation,
    CapsuleRole.SourceBasis,
    CapsuleRole.Artifact,
    CapsuleRole.Attribution
] as const;

export function CapsuleRole_parse(s: string): CapsuleRole {
    const found = CapsuleRole_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown CapsuleRole variant: " + s);
    }
    return found;
}

export class CapsuleRole_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CapsuleRole): unknown {
        if (this !== CapsuleRole_JsonCodec.lazyInstance.value) {
          return CapsuleRole_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CapsuleRole {
        if (this !== CapsuleRole_JsonCodec .lazyInstance.value) {
            return CapsuleRole_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return CapsuleRole_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleRole_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleRole_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleRole'
    public baboonTypeIdentifier() {
        return CapsuleRole_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CapsuleRole_JsonCodec())
    public static get instance(): CapsuleRole_JsonCodec {
        return CapsuleRole_JsonCodec.lazyInstance.value
    }
}