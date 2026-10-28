import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class SearchFilter implements BaboonGenerated {
    private readonly _project: string | undefined;
    private readonly _gitBranch: string | undefined;
    private readonly _after: string | undefined;
    private readonly _before: string | undefined;
    private readonly _tags: Array<string>;

    constructor(project: string | undefined, gitBranch: string | undefined, after: string | undefined, before: string | undefined, tags: Array<string>) {
        this._project = project
        this._gitBranch = gitBranch
        this._after = after
        this._before = before
        this._tags = tags
    }

    public get project(): string | undefined {
        return this._project;
    }
    public get gitBranch(): string | undefined {
        return this._gitBranch;
    }
    public get after(): string | undefined {
        return this._after;
    }
    public get before(): string | undefined {
        return this._before;
    }
    public get tags(): Array<string> {
        return this._tags;
    }

    public toJSON(): Record<string, unknown> {
        return {
            project: this._project !== undefined ? this._project : undefined,
            gitBranch: this._gitBranch !== undefined ? this._gitBranch : undefined,
            after: this._after !== undefined ? this._after : undefined,
            before: this._before !== undefined ? this._before : undefined,
            tags: this._tags
        };
    }

    public with(overrides: {project?: string | undefined; gitBranch?: string | undefined; after?: string | undefined; before?: string | undefined; tags?: Array<string>}): SearchFilter {
        return new SearchFilter(
            'project' in overrides ? overrides.project! : this._project,
            'gitBranch' in overrides ? overrides.gitBranch! : this._gitBranch,
            'after' in overrides ? overrides.after! : this._after,
            'before' in overrides ? overrides.before! : this._before,
            'tags' in overrides ? overrides.tags! : this._tags
        );
    }

    public static fromPlain(obj: {project: string | undefined; gitBranch: string | undefined; after: string | undefined; before: string | undefined; tags: Array<string>}): SearchFilter {
        return new SearchFilter(
            obj.project,
            obj.gitBranch,
            obj.after,
            obj.before,
            obj.tags
        );
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return SearchFilter.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SearchFilter.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SearchFilter'
    public baboonTypeIdentifier() {
        return SearchFilter.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return SearchFilter.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.2.0": "identical", "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return SearchFilter.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return SearchFilter.BaboonMinReaderVersions
    }
    public static jsonCodec(): SearchFilter_JsonCodec {
        return SearchFilter_JsonCodec.instance
    }
}

/** @deprecated Version 1.2.0 is deprecated, you should migrate to 1.7.0 */
export class SearchFilter_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SearchFilter): unknown {
        if (this !== SearchFilter_JsonCodec.lazyInstance.value) {
          return SearchFilter_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "project": value.project === undefined ? null : value.project,
            "gitBranch": value.gitBranch === undefined ? null : value.gitBranch,
            "after": value.after === undefined ? null : value.after,
            "before": value.before === undefined ? null : value.before,
            "tags": Array.from(value.tags),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SearchFilter {
        if (this !== SearchFilter_JsonCodec .lazyInstance.value) {
            return SearchFilter_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SearchFilter (
            obj["project"] === undefined || obj["project"] === null ? undefined : obj["project"] === undefined || obj["project"] === null ? undefined : obj["project"] as string,
            obj["gitBranch"] === undefined || obj["gitBranch"] === null ? undefined : obj["gitBranch"] === undefined || obj["gitBranch"] === null ? undefined : obj["gitBranch"] as string,
            obj["after"] === undefined || obj["after"] === null ? undefined : obj["after"] === undefined || obj["after"] === null ? undefined : obj["after"] as string,
            obj["before"] === undefined || obj["before"] === null ? undefined : obj["before"] === undefined || obj["before"] === null ? undefined : obj["before"] as string,
            (obj["tags"] as unknown[]).map(item => item as string),
        )
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return SearchFilter_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SearchFilter_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SearchFilter'
    public baboonTypeIdentifier() {
        return SearchFilter_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SearchFilter_JsonCodec())
    public static get instance(): SearchFilter_JsonCodec {
        return SearchFilter_JsonCodec.lazyInstance.value
    }
}