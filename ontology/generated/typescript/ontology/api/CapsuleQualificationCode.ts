import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum CapsuleQualificationCode {
    CoverageLag = "CoverageLag",
    NoCurationPublication = "NoCurationPublication",
    GraphChangedAfterCuration = "GraphChangedAfterCuration",
    ReportedContextUnknown = "ReportedContextUnknown",
    UnresolvedApplicability = "UnresolvedApplicability",
    UnboundIntent = "UnboundIntent",
    StaleBinding = "StaleBinding",
    StaleWarrant = "StaleWarrant",
    MissingHumanBasis = "MissingHumanBasis",
    AmbiguousHumanBasis = "AmbiguousHumanBasis",
    UnresolvedConflict = "UnresolvedConflict",
    UnresolvedChange = "UnresolvedChange",
    HistoricalEvidence = "HistoricalEvidence"
}

export const CapsuleQualificationCode_values: ReadonlyArray<CapsuleQualificationCode> = [
    CapsuleQualificationCode.CoverageLag,
    CapsuleQualificationCode.NoCurationPublication,
    CapsuleQualificationCode.GraphChangedAfterCuration,
    CapsuleQualificationCode.ReportedContextUnknown,
    CapsuleQualificationCode.UnresolvedApplicability,
    CapsuleQualificationCode.UnboundIntent,
    CapsuleQualificationCode.StaleBinding,
    CapsuleQualificationCode.StaleWarrant,
    CapsuleQualificationCode.MissingHumanBasis,
    CapsuleQualificationCode.AmbiguousHumanBasis,
    CapsuleQualificationCode.UnresolvedConflict,
    CapsuleQualificationCode.UnresolvedChange,
    CapsuleQualificationCode.HistoricalEvidence
] as const;

export function CapsuleQualificationCode_parse(s: string): CapsuleQualificationCode {
    const found = CapsuleQualificationCode_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown CapsuleQualificationCode variant: " + s);
    }
    return found;
}

export class CapsuleQualificationCode_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CapsuleQualificationCode): unknown {
        if (this !== CapsuleQualificationCode_JsonCodec.lazyInstance.value) {
          return CapsuleQualificationCode_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CapsuleQualificationCode {
        if (this !== CapsuleQualificationCode_JsonCodec .lazyInstance.value) {
            return CapsuleQualificationCode_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return CapsuleQualificationCode_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleQualificationCode_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleQualificationCode_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleQualificationCode'
    public baboonTypeIdentifier() {
        return CapsuleQualificationCode_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CapsuleQualificationCode_JsonCodec())
    public static get instance(): CapsuleQualificationCode_JsonCodec {
        return CapsuleQualificationCode_JsonCodec.lazyInstance.value
    }
}