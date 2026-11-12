import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ProjectionCheckpoint, ProjectionCheckpoint_JsonCodec} from './ProjectionCheckpoint.js'

export class ProjectionCheckpointWitness implements BaboonGeneratedLatest {
    private readonly _checkpoint: ProjectionCheckpoint;
    private readonly _sessionId: string;
    private readonly _requestId: string;

    constructor(checkpoint: ProjectionCheckpoint, sessionId: string, requestId: string) {
        this._checkpoint = checkpoint
        this._sessionId = sessionId
        this._requestId = requestId
    }

    public get checkpoint(): ProjectionCheckpoint {
        return this._checkpoint;
    }
    public get sessionId(): string {
        return this._sessionId;
    }
    public get requestId(): string {
        return this._requestId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            checkpoint: this._checkpoint,
            sessionId: this._sessionId,
            requestId: this._requestId
        };
    }

    public with(overrides: {checkpoint?: ProjectionCheckpoint; sessionId?: string; requestId?: string}): ProjectionCheckpointWitness {
        return new ProjectionCheckpointWitness(
            'checkpoint' in overrides ? overrides.checkpoint! : this._checkpoint,
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId,
            'requestId' in overrides ? overrides.requestId! : this._requestId
        );
    }

    public static fromPlain(obj: {checkpoint: ProjectionCheckpoint; sessionId: string; requestId: string}): ProjectionCheckpointWitness {
        return new ProjectionCheckpointWitness(
            obj.checkpoint,
            obj.sessionId,
            obj.requestId
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionCheckpointWitness.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionCheckpointWitness.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionCheckpointWitness'
    public baboonTypeIdentifier() {
        return ProjectionCheckpointWitness.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ProjectionCheckpointWitness.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ProjectionCheckpointWitness.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ProjectionCheckpointWitness.BaboonMinReaderVersions
    }
    public static jsonCodec(): ProjectionCheckpointWitness_JsonCodec {
        return ProjectionCheckpointWitness_JsonCodec.instance
    }
}

export class ProjectionCheckpointWitness_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ProjectionCheckpointWitness): unknown {
        if (this !== ProjectionCheckpointWitness_JsonCodec.lazyInstance.value) {
          return ProjectionCheckpointWitness_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "checkpoint": ProjectionCheckpoint_JsonCodec.instance.encode(BaboonCodecContext.Default, value.checkpoint),
            "sessionId": value.sessionId,
            "requestId": value.requestId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ProjectionCheckpointWitness {
        if (this !== ProjectionCheckpointWitness_JsonCodec .lazyInstance.value) {
            return ProjectionCheckpointWitness_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ProjectionCheckpointWitness (
            ProjectionCheckpoint_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["checkpoint"]),
            obj["sessionId"] as string,
            obj["requestId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionCheckpointWitness_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionCheckpointWitness_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionCheckpointWitness'
    public baboonTypeIdentifier() {
        return ProjectionCheckpointWitness_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ProjectionCheckpointWitness_JsonCodec())
    public static get instance(): ProjectionCheckpointWitness_JsonCodec {
        return ProjectionCheckpointWitness_JsonCodec.lazyInstance.value
    }
}