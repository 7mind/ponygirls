import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ProjectionCheckpoint, ProjectionCheckpoint_JsonCodec} from './ProjectionCheckpoint.js'
import {ProjectionTarget, ProjectionTarget_JsonCodec} from './ProjectionTarget.js'

export class ProjectionAckInput implements BaboonGeneratedLatest {
    private readonly _sessionId: string;
    private readonly _requestId: string;
    private readonly _target: ProjectionTarget;
    private readonly _observed: ProjectionCheckpoint;

    constructor(sessionId: string, requestId: string, target: ProjectionTarget, observed: ProjectionCheckpoint) {
        this._sessionId = sessionId
        this._requestId = requestId
        this._target = target
        this._observed = observed
    }

    public get sessionId(): string {
        return this._sessionId;
    }
    public get requestId(): string {
        return this._requestId;
    }
    public get target(): ProjectionTarget {
        return this._target;
    }
    public get observed(): ProjectionCheckpoint {
        return this._observed;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sessionId: this._sessionId,
            requestId: this._requestId,
            target: this._target,
            observed: this._observed
        };
    }

    public with(overrides: {sessionId?: string; requestId?: string; target?: ProjectionTarget; observed?: ProjectionCheckpoint}): ProjectionAckInput {
        return new ProjectionAckInput(
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId,
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'target' in overrides ? overrides.target! : this._target,
            'observed' in overrides ? overrides.observed! : this._observed
        );
    }

    public static fromPlain(obj: {sessionId: string; requestId: string; target: ProjectionTarget; observed: ProjectionCheckpoint}): ProjectionAckInput {
        return new ProjectionAckInput(
            obj.sessionId,
            obj.requestId,
            obj.target,
            obj.observed
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionAckInput.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionAckInput.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionAckInput'
    public baboonTypeIdentifier() {
        return ProjectionAckInput.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ProjectionAckInput.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ProjectionAckInput.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ProjectionAckInput.BaboonMinReaderVersions
    }
    public static jsonCodec(): ProjectionAckInput_JsonCodec {
        return ProjectionAckInput_JsonCodec.instance
    }
}

export class ProjectionAckInput_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ProjectionAckInput): unknown {
        if (this !== ProjectionAckInput_JsonCodec.lazyInstance.value) {
          return ProjectionAckInput_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sessionId": value.sessionId,
            "requestId": value.requestId,
            "target": ProjectionTarget_JsonCodec.instance.encode(BaboonCodecContext.Default, value.target),
            "observed": ProjectionCheckpoint_JsonCodec.instance.encode(BaboonCodecContext.Default, value.observed),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ProjectionAckInput {
        if (this !== ProjectionAckInput_JsonCodec .lazyInstance.value) {
            return ProjectionAckInput_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ProjectionAckInput (
            obj["sessionId"] as string,
            obj["requestId"] as string,
            ProjectionTarget_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["target"]),
            ProjectionCheckpoint_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["observed"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionAckInput_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionAckInput_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionAckInput'
    public baboonTypeIdentifier() {
        return ProjectionAckInput_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ProjectionAckInput_JsonCodec())
    public static get instance(): ProjectionAckInput_JsonCodec {
        return ProjectionAckInput_JsonCodec.lazyInstance.value
    }
}