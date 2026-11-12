import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ProjectionIssuedBatch, ProjectionIssuedBatch_JsonCodec} from './ProjectionIssuedBatch.js'

export class ProjectionProgress implements BaboonGeneratedLatest {
    private readonly _issuedThrough: number;
    private readonly _batch: ProjectionIssuedBatch | undefined;

    constructor(issuedThrough: number, batch: ProjectionIssuedBatch | undefined) {
        this._issuedThrough = issuedThrough
        this._batch = batch
    }

    public get issuedThrough(): number {
        return this._issuedThrough;
    }
    public get batch(): ProjectionIssuedBatch | undefined {
        return this._batch;
    }

    public toJSON(): Record<string, unknown> {
        return {
            issuedThrough: this._issuedThrough,
            batch: this._batch !== undefined ? this._batch : undefined
        };
    }

    public with(overrides: {issuedThrough?: number; batch?: ProjectionIssuedBatch | undefined}): ProjectionProgress {
        return new ProjectionProgress(
            'issuedThrough' in overrides ? overrides.issuedThrough! : this._issuedThrough,
            'batch' in overrides ? overrides.batch! : this._batch
        );
    }

    public static fromPlain(obj: {issuedThrough: number; batch: ProjectionIssuedBatch | undefined}): ProjectionProgress {
        return new ProjectionProgress(
            obj.issuedThrough,
            obj.batch
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionProgress.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionProgress.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionProgress'
    public baboonTypeIdentifier() {
        return ProjectionProgress.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ProjectionProgress.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ProjectionProgress.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ProjectionProgress.BaboonMinReaderVersions
    }
    public static jsonCodec(): ProjectionProgress_JsonCodec {
        return ProjectionProgress_JsonCodec.instance
    }
}

export class ProjectionProgress_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ProjectionProgress): unknown {
        if (this !== ProjectionProgress_JsonCodec.lazyInstance.value) {
          return ProjectionProgress_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "issuedThrough": value.issuedThrough,
            "batch": value.batch === undefined ? null : ProjectionIssuedBatch_JsonCodec.instance.encode(BaboonCodecContext.Default, value.batch),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ProjectionProgress {
        if (this !== ProjectionProgress_JsonCodec .lazyInstance.value) {
            return ProjectionProgress_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ProjectionProgress (
            obj["issuedThrough"] as number,
            obj["batch"] === undefined || obj["batch"] === null ? undefined : obj["batch"] === undefined || obj["batch"] === null ? undefined : ProjectionIssuedBatch_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["batch"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionProgress_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionProgress_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionProgress'
    public baboonTypeIdentifier() {
        return ProjectionProgress_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ProjectionProgress_JsonCodec())
    public static get instance(): ProjectionProgress_JsonCodec {
        return ProjectionProgress_JsonCodec.lazyInstance.value
    }
}