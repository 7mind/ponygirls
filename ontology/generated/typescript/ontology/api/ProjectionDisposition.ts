import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ProjectionDisposition {
    ExactCheckpoint = "ExactCheckpoint",
    SupersededByCheckpoint = "SupersededByCheckpoint"
}

export const ProjectionDisposition_values: ReadonlyArray<ProjectionDisposition> = [
    ProjectionDisposition.ExactCheckpoint,
    ProjectionDisposition.SupersededByCheckpoint
] as const;

export function ProjectionDisposition_parse(s: string): ProjectionDisposition {
    const found = ProjectionDisposition_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ProjectionDisposition variant: " + s);
    }
    return found;
}

export class ProjectionDisposition_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ProjectionDisposition): unknown {
        if (this !== ProjectionDisposition_JsonCodec.lazyInstance.value) {
          return ProjectionDisposition_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ProjectionDisposition {
        if (this !== ProjectionDisposition_JsonCodec .lazyInstance.value) {
            return ProjectionDisposition_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ProjectionDisposition_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionDisposition_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionDisposition_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionDisposition'
    public baboonTypeIdentifier() {
        return ProjectionDisposition_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ProjectionDisposition_JsonCodec())
    public static get instance(): ProjectionDisposition_JsonCodec {
        return ProjectionDisposition_JsonCodec.lazyInstance.value
    }
}