import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {ProjectionInstance, ProjectionInstance_JsonCodec} from './ProjectionInstance.js'

export class ProjectionCheckpoint implements BaboonGeneratedLatest {
    private readonly _instance: ProjectionInstance;
    private readonly _scope: string;
    private readonly _generation: bigint;
    private readonly _digest: string;

    constructor(instance: ProjectionInstance, scope: string, generation: bigint, digest: string) {
        this._instance = instance
        this._scope = scope
        this._generation = generation
        this._digest = digest
    }

    public get instance(): ProjectionInstance {
        return this._instance;
    }
    public get scope(): string {
        return this._scope;
    }
    public get generation(): bigint {
        return this._generation;
    }
    public get digest(): string {
        return this._digest;
    }

    public toJSON(): Record<string, unknown> {
        return {
            instance: this._instance,
            scope: this._scope,
            generation: this._generation,
            digest: this._digest
        };
    }

    public with(overrides: {instance?: ProjectionInstance; scope?: string; generation?: bigint; digest?: string}): ProjectionCheckpoint {
        return new ProjectionCheckpoint(
            'instance' in overrides ? overrides.instance! : this._instance,
            'scope' in overrides ? overrides.scope! : this._scope,
            'generation' in overrides ? overrides.generation! : this._generation,
            'digest' in overrides ? overrides.digest! : this._digest
        );
    }

    public static fromPlain(obj: {instance: ProjectionInstance; scope: string; generation: bigint; digest: string}): ProjectionCheckpoint {
        return new ProjectionCheckpoint(
            obj.instance,
            obj.scope,
            obj.generation,
            obj.digest
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionCheckpoint.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionCheckpoint.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionCheckpoint'
    public baboonTypeIdentifier() {
        return ProjectionCheckpoint.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ProjectionCheckpoint.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ProjectionCheckpoint.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ProjectionCheckpoint.BaboonMinReaderVersions
    }
    public static jsonCodec(): ProjectionCheckpoint_JsonCodec {
        return ProjectionCheckpoint_JsonCodec.instance
    }
}

export class ProjectionCheckpoint_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ProjectionCheckpoint): unknown {
        if (this !== ProjectionCheckpoint_JsonCodec.lazyInstance.value) {
          return ProjectionCheckpoint_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "instance": ProjectionInstance_JsonCodec.instance.encode(BaboonCodecContext.Default, value.instance),
            "scope": value.scope,
            "generation": value.generation.toString(),
            "digest": value.digest,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ProjectionCheckpoint {
        if (this !== ProjectionCheckpoint_JsonCodec .lazyInstance.value) {
            return ProjectionCheckpoint_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ProjectionCheckpoint (
            ProjectionInstance_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["instance"]),
            obj["scope"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
            obj["digest"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionCheckpoint_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionCheckpoint_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionCheckpoint'
    public baboonTypeIdentifier() {
        return ProjectionCheckpoint_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ProjectionCheckpoint_JsonCodec())
    public static get instance(): ProjectionCheckpoint_JsonCodec {
        return ProjectionCheckpoint_JsonCodec.lazyInstance.value
    }
}