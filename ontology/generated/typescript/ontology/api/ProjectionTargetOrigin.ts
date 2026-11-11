import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ProjectionTargetOrigin {
    Head = "Head",
    Outbox = "Outbox"
}

export const ProjectionTargetOrigin_values: ReadonlyArray<ProjectionTargetOrigin> = [
    ProjectionTargetOrigin.Head,
    ProjectionTargetOrigin.Outbox
] as const;

export function ProjectionTargetOrigin_parse(s: string): ProjectionTargetOrigin {
    const found = ProjectionTargetOrigin_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ProjectionTargetOrigin variant: " + s);
    }
    return found;
}

export class ProjectionTargetOrigin_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ProjectionTargetOrigin): unknown {
        if (this !== ProjectionTargetOrigin_JsonCodec.lazyInstance.value) {
          return ProjectionTargetOrigin_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ProjectionTargetOrigin {
        if (this !== ProjectionTargetOrigin_JsonCodec .lazyInstance.value) {
            return ProjectionTargetOrigin_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ProjectionTargetOrigin_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionTargetOrigin_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionTargetOrigin_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionTargetOrigin'
    public baboonTypeIdentifier() {
        return ProjectionTargetOrigin_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ProjectionTargetOrigin_JsonCodec())
    public static get instance(): ProjectionTargetOrigin_JsonCodec {
        return ProjectionTargetOrigin_JsonCodec.lazyInstance.value
    }
}