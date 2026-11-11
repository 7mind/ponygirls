import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {ProjectionTargetOrigin, ProjectionTargetOrigin_JsonCodec} from './ProjectionTargetOrigin.js'

export class ProjectionTarget implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _generation: bigint;
    private readonly _digest: string;
    private readonly _origin: ProjectionTargetOrigin;

    constructor(scope: string, generation: bigint, digest: string, origin: ProjectionTargetOrigin) {
        this._scope = scope
        this._generation = generation
        this._digest = digest
        this._origin = origin
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
    public get origin(): ProjectionTargetOrigin {
        return this._origin;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            generation: this._generation,
            digest: this._digest,
            origin: this._origin
        };
    }

    public with(overrides: {scope?: string; generation?: bigint; digest?: string; origin?: ProjectionTargetOrigin}): ProjectionTarget {
        return new ProjectionTarget(
            'scope' in overrides ? overrides.scope! : this._scope,
            'generation' in overrides ? overrides.generation! : this._generation,
            'digest' in overrides ? overrides.digest! : this._digest,
            'origin' in overrides ? overrides.origin! : this._origin
        );
    }

    public static fromPlain(obj: {scope: string; generation: bigint; digest: string; origin: ProjectionTargetOrigin}): ProjectionTarget {
        return new ProjectionTarget(
            obj.scope,
            obj.generation,
            obj.digest,
            obj.origin
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionTarget.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionTarget.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionTarget'
    public baboonTypeIdentifier() {
        return ProjectionTarget.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ProjectionTarget.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ProjectionTarget.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ProjectionTarget.BaboonMinReaderVersions
    }
    public static jsonCodec(): ProjectionTarget_JsonCodec {
        return ProjectionTarget_JsonCodec.instance
    }
}

export class ProjectionTarget_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ProjectionTarget): unknown {
        if (this !== ProjectionTarget_JsonCodec.lazyInstance.value) {
          return ProjectionTarget_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "generation": value.generation.toString(),
            "digest": value.digest,
            "origin": ProjectionTargetOrigin_JsonCodec.instance.encode(BaboonCodecContext.Default, value.origin),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ProjectionTarget {
        if (this !== ProjectionTarget_JsonCodec .lazyInstance.value) {
            return ProjectionTarget_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ProjectionTarget (
            obj["scope"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
            obj["digest"] as string,
            ProjectionTargetOrigin_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["origin"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionTarget_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionTarget_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionTarget'
    public baboonTypeIdentifier() {
        return ProjectionTarget_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ProjectionTarget_JsonCodec())
    public static get instance(): ProjectionTarget_JsonCodec {
        return ProjectionTarget_JsonCodec.lazyInstance.value
    }
}