import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ProjectionTarget, ProjectionTarget_JsonCodec} from './ProjectionTarget.js'

export class ProjectionIssuedBatch implements BaboonGeneratedLatest {
    private readonly _startIndex: number;
    private readonly _targets: Array<ProjectionTarget>;

    constructor(startIndex: number, targets: Array<ProjectionTarget>) {
        this._startIndex = startIndex
        this._targets = targets
    }

    public get startIndex(): number {
        return this._startIndex;
    }
    public get targets(): Array<ProjectionTarget> {
        return this._targets;
    }

    public toJSON(): Record<string, unknown> {
        return {
            startIndex: this._startIndex,
            targets: this._targets
        };
    }

    public with(overrides: {startIndex?: number; targets?: Array<ProjectionTarget>}): ProjectionIssuedBatch {
        return new ProjectionIssuedBatch(
            'startIndex' in overrides ? overrides.startIndex! : this._startIndex,
            'targets' in overrides ? overrides.targets! : this._targets
        );
    }

    public static fromPlain(obj: {startIndex: number; targets: Array<ProjectionTarget>}): ProjectionIssuedBatch {
        return new ProjectionIssuedBatch(
            obj.startIndex,
            obj.targets
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionIssuedBatch.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionIssuedBatch.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionIssuedBatch'
    public baboonTypeIdentifier() {
        return ProjectionIssuedBatch.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ProjectionIssuedBatch.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ProjectionIssuedBatch.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ProjectionIssuedBatch.BaboonMinReaderVersions
    }
    public static jsonCodec(): ProjectionIssuedBatch_JsonCodec {
        return ProjectionIssuedBatch_JsonCodec.instance
    }
}

export class ProjectionIssuedBatch_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ProjectionIssuedBatch): unknown {
        if (this !== ProjectionIssuedBatch_JsonCodec.lazyInstance.value) {
          return ProjectionIssuedBatch_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "startIndex": value.startIndex,
            "targets": Array.from(value.targets).map(item => ProjectionTarget_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ProjectionIssuedBatch {
        if (this !== ProjectionIssuedBatch_JsonCodec .lazyInstance.value) {
            return ProjectionIssuedBatch_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ProjectionIssuedBatch (
            obj["startIndex"] as number,
            (obj["targets"] as unknown[]).map(item => ProjectionTarget_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ProjectionIssuedBatch_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ProjectionIssuedBatch_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ProjectionIssuedBatch'
    public baboonTypeIdentifier() {
        return ProjectionIssuedBatch_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ProjectionIssuedBatch_JsonCodec())
    public static get instance(): ProjectionIssuedBatch_JsonCodec {
        return ProjectionIssuedBatch_JsonCodec.lazyInstance.value
    }
}