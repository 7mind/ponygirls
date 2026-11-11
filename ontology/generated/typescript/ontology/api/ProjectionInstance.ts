import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class ProjectionInstance implements BaboonGeneratedLatest {
    private readonly _targetId: string;
    private readonly _incarnation: string;

    constructor(targetId: string, incarnation: string) {
        this._targetId = targetId
        this._incarnation = incarnation
    }

    public get targetId(): string {
        return this._targetId;
    }
    public get incarnation(): string {
        return this._incarnation;
    }

    public toJSON(): Record<string, unknown> {
        return {
            targetId: this._targetId,
            incarnation: this._incarnation
        };
    }

    public with(overrides: {targetId?: string; incarnation?: string}): ProjectionInstance {
        return new ProjectionInstance(
            'targetId' in overrides ? overrides.targetId! : this._targetId,
            'incarnation' in overrides ? overrides.incarnation! : this._incarnation
        );
    }

    public static fromPlain(obj: {targetId: string; incarnation: string}): ProjectionInstance {
        return new ProjectionInstance(
            obj.targetId,
            obj.incarnation
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionInstance.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionInstance.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionInstance'
    public baboonTypeIdentifier() {
        return ProjectionInstance.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ProjectionInstance.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ProjectionInstance.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ProjectionInstance.BaboonMinReaderVersions
    }
    public static jsonCodec(): ProjectionInstance_JsonCodec {
        return ProjectionInstance_JsonCodec.instance
    }
}

export class ProjectionInstance_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ProjectionInstance): unknown {
        if (this !== ProjectionInstance_JsonCodec.lazyInstance.value) {
          return ProjectionInstance_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "targetId": value.targetId,
            "incarnation": value.incarnation,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ProjectionInstance {
        if (this !== ProjectionInstance_JsonCodec .lazyInstance.value) {
            return ProjectionInstance_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ProjectionInstance (
            obj["targetId"] as string,
            obj["incarnation"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionInstance_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionInstance_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionInstance'
    public baboonTypeIdentifier() {
        return ProjectionInstance_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ProjectionInstance_JsonCodec())
    public static get instance(): ProjectionInstance_JsonCodec {
        return ProjectionInstance_JsonCodec.lazyInstance.value
    }
}