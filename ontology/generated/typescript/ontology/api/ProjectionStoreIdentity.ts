import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ProjectionInstance, ProjectionInstance_JsonCodec} from './ProjectionInstance.js'

export class ProjectionStoreIdentity implements BaboonGeneratedLatest {
    private readonly _format: number;
    private readonly _instance: ProjectionInstance;

    constructor(format: number, instance: ProjectionInstance) {
        this._format = format
        this._instance = instance
    }

    public get format(): number {
        return this._format;
    }
    public get instance(): ProjectionInstance {
        return this._instance;
    }

    public toJSON(): Record<string, unknown> {
        return {
            format: this._format,
            instance: this._instance
        };
    }

    public with(overrides: {format?: number; instance?: ProjectionInstance}): ProjectionStoreIdentity {
        return new ProjectionStoreIdentity(
            'format' in overrides ? overrides.format! : this._format,
            'instance' in overrides ? overrides.instance! : this._instance
        );
    }

    public static fromPlain(obj: {format: number; instance: ProjectionInstance}): ProjectionStoreIdentity {
        return new ProjectionStoreIdentity(
            obj.format,
            obj.instance
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionStoreIdentity.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionStoreIdentity.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionStoreIdentity'
    public baboonTypeIdentifier() {
        return ProjectionStoreIdentity.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ProjectionStoreIdentity.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ProjectionStoreIdentity.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ProjectionStoreIdentity.BaboonMinReaderVersions
    }
    public static jsonCodec(): ProjectionStoreIdentity_JsonCodec {
        return ProjectionStoreIdentity_JsonCodec.instance
    }
}

export class ProjectionStoreIdentity_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ProjectionStoreIdentity): unknown {
        if (this !== ProjectionStoreIdentity_JsonCodec.lazyInstance.value) {
          return ProjectionStoreIdentity_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "format": value.format,
            "instance": ProjectionInstance_JsonCodec.instance.encode(BaboonCodecContext.Default, value.instance),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ProjectionStoreIdentity {
        if (this !== ProjectionStoreIdentity_JsonCodec .lazyInstance.value) {
            return ProjectionStoreIdentity_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ProjectionStoreIdentity (
            obj["format"] as number,
            ProjectionInstance_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["instance"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionStoreIdentity_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionStoreIdentity_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionStoreIdentity'
    public baboonTypeIdentifier() {
        return ProjectionStoreIdentity_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ProjectionStoreIdentity_JsonCodec())
    public static get instance(): ProjectionStoreIdentity_JsonCodec {
        return ProjectionStoreIdentity_JsonCodec.lazyInstance.value
    }
}