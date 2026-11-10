import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum RelationKind {
    Quotes = "Quotes",
    Interprets = "Interprets",
    Infers = "Infers",
    Assumes = "Assumes",
    Supports = "Supports",
    Challenges = "Challenges",
    Adopts = "Adopts",
    Chooses = "Chooses",
    Delegates = "Delegates",
    Supersedes = "Supersedes",
    Withdraws = "Withdraws",
    ContributesTo = "ContributesTo",
    DependsOn = "DependsOn",
    Requires = "Requires",
    Decomposes = "Decomposes",
    AssignedTo = "AssignedTo",
    PlannedOutput = "PlannedOutput",
    Produced = "Produced",
    Answers = "Answers",
    Assesses = "Assesses"
}

export const RelationKind_values: ReadonlyArray<RelationKind> = [
    RelationKind.Quotes,
    RelationKind.Interprets,
    RelationKind.Infers,
    RelationKind.Assumes,
    RelationKind.Supports,
    RelationKind.Challenges,
    RelationKind.Adopts,
    RelationKind.Chooses,
    RelationKind.Delegates,
    RelationKind.Supersedes,
    RelationKind.Withdraws,
    RelationKind.ContributesTo,
    RelationKind.DependsOn,
    RelationKind.Requires,
    RelationKind.Decomposes,
    RelationKind.AssignedTo,
    RelationKind.PlannedOutput,
    RelationKind.Produced,
    RelationKind.Answers,
    RelationKind.Assesses
] as const;

export function RelationKind_parse(s: string): RelationKind {
    const found = RelationKind_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown RelationKind variant: " + s);
    }
    return found;
}

export class RelationKind_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RelationKind): unknown {
        if (this !== RelationKind_JsonCodec.lazyInstance.value) {
          return RelationKind_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RelationKind {
        if (this !== RelationKind_JsonCodec .lazyInstance.value) {
            return RelationKind_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return RelationKind_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return RelationKind_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return RelationKind_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#RelationKind'
    public baboonTypeIdentifier() {
        return RelationKind_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RelationKind_JsonCodec())
    public static get instance(): RelationKind_JsonCodec {
        return RelationKind_JsonCodec.lazyInstance.value
    }
}