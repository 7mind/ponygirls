import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum DefinitionKind {
    Outcome = "Outcome",
    Constraint = "Constraint",
    Task = "Task",
    Statement = "Statement",
    Hypothesis = "Hypothesis",
    Defect = "Defect",
    Question = "Question",
    Decision = "Decision",
    Review = "Review",
    Source = "Source",
    Artifact = "Artifact",
    Conflict = "Conflict"
}

export const DefinitionKind_values: ReadonlyArray<DefinitionKind> = [
    DefinitionKind.Outcome,
    DefinitionKind.Constraint,
    DefinitionKind.Task,
    DefinitionKind.Statement,
    DefinitionKind.Hypothesis,
    DefinitionKind.Defect,
    DefinitionKind.Question,
    DefinitionKind.Decision,
    DefinitionKind.Review,
    DefinitionKind.Source,
    DefinitionKind.Artifact,
    DefinitionKind.Conflict
] as const;

export function DefinitionKind_parse(s: string): DefinitionKind {
    const found = DefinitionKind_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown DefinitionKind variant: " + s);
    }
    return found;
}

export class DefinitionKind_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: DefinitionKind): unknown {
        if (this !== DefinitionKind_JsonCodec.lazyInstance.value) {
          return DefinitionKind_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): DefinitionKind {
        if (this !== DefinitionKind_JsonCodec .lazyInstance.value) {
            return DefinitionKind_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return DefinitionKind_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return DefinitionKind_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return DefinitionKind_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#DefinitionKind'
    public baboonTypeIdentifier() {
        return DefinitionKind_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new DefinitionKind_JsonCodec())
    public static get instance(): DefinitionKind_JsonCodec {
        return DefinitionKind_JsonCodec.lazyInstance.value
    }
}