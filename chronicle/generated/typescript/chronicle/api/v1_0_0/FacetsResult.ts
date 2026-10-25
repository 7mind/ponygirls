import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {Facet, Facet_JsonCodec} from './Facet.js'

export class FacetsResult implements BaboonGenerated {
    private readonly _projects: Array<Facet>;
    private readonly _branches: Array<Facet>;
    private readonly _tags: Array<Facet>;

    constructor(projects: Array<Facet>, branches: Array<Facet>, tags: Array<Facet>) {
        this._projects = projects
        this._branches = branches
        this._tags = tags
    }

    public get projects(): Array<Facet> {
        return this._projects;
    }
    public get branches(): Array<Facet> {
        return this._branches;
    }
    public get tags(): Array<Facet> {
        return this._tags;
    }

    public toJSON(): Record<string, unknown> {
        return {
            projects: this._projects,
            branches: this._branches,
            tags: this._tags
        };
    }

    public with(overrides: {projects?: Array<Facet>; branches?: Array<Facet>; tags?: Array<Facet>}): FacetsResult {
        return new FacetsResult(
            'projects' in overrides ? overrides.projects! : this._projects,
            'branches' in overrides ? overrides.branches! : this._branches,
            'tags' in overrides ? overrides.tags! : this._tags
        );
    }

    public static fromPlain(obj: {projects: Array<Facet>; branches: Array<Facet>; tags: Array<Facet>}): FacetsResult {
        return new FacetsResult(
            obj.projects,
            obj.branches,
            obj.tags
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return FacetsResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return FacetsResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#FacetsResult'
    public baboonTypeIdentifier() {
        return FacetsResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0"]
    public baboonSameInVersions() {
        return FacetsResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical", "1.1.0": "identical" }
    public baboonForwardReadable() {
        return FacetsResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return FacetsResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): FacetsResult_JsonCodec {
        return FacetsResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.0.0 is deprecated, you should migrate to 1.1.0 */
export class FacetsResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: FacetsResult): unknown {
        if (this !== FacetsResult_JsonCodec.lazyInstance.value) {
          return FacetsResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "projects": Array.from(value.projects).map(item => Facet_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "branches": Array.from(value.branches).map(item => Facet_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "tags": Array.from(value.tags).map(item => Facet_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): FacetsResult {
        if (this !== FacetsResult_JsonCodec .lazyInstance.value) {
            return FacetsResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new FacetsResult (
            (obj["projects"] as unknown[]).map(item => Facet_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["branches"] as unknown[]).map(item => Facet_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["tags"] as unknown[]).map(item => Facet_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return FacetsResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return FacetsResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#FacetsResult'
    public baboonTypeIdentifier() {
        return FacetsResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new FacetsResult_JsonCodec())
    public static get instance(): FacetsResult_JsonCodec {
        return FacetsResult_JsonCodec.lazyInstance.value
    }
}