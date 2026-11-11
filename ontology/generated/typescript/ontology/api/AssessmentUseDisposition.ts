import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum AssessmentUseDisposition {
    Applicable = "Applicable",
    Excluded = "Excluded",
    Unresolved = "Unresolved"
}

export const AssessmentUseDisposition_values: ReadonlyArray<AssessmentUseDisposition> = [
    AssessmentUseDisposition.Applicable,
    AssessmentUseDisposition.Excluded,
    AssessmentUseDisposition.Unresolved
] as const;

export function AssessmentUseDisposition_parse(s: string): AssessmentUseDisposition {
    const found = AssessmentUseDisposition_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown AssessmentUseDisposition variant: " + s);
    }
    return found;
}

export class AssessmentUseDisposition_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: AssessmentUseDisposition): unknown {
        if (this !== AssessmentUseDisposition_JsonCodec.lazyInstance.value) {
          return AssessmentUseDisposition_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): AssessmentUseDisposition {
        if (this !== AssessmentUseDisposition_JsonCodec .lazyInstance.value) {
            return AssessmentUseDisposition_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return AssessmentUseDisposition_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return AssessmentUseDisposition_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return AssessmentUseDisposition_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#AssessmentUseDisposition'
    public baboonTypeIdentifier() {
        return AssessmentUseDisposition_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new AssessmentUseDisposition_JsonCodec())
    public static get instance(): AssessmentUseDisposition_JsonCodec {
        return AssessmentUseDisposition_JsonCodec.lazyInstance.value
    }
}