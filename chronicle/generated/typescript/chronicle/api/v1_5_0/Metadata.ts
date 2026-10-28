import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class Metadata implements BaboonGenerated {
    private readonly _title: string;
    private readonly _project: string | undefined;
    private readonly _workdir: string | undefined;
    private readonly _gitRemote: string | undefined;
    private readonly _gitBranch: string | undefined;
    private readonly _gitCommit: string | undefined;
    private readonly _producer: string;
    private readonly _model: string | undefined;
    private readonly _startedAt: string | undefined;
    private readonly _endedAt: string | undefined;
    private readonly _tags: Array<string>;

    constructor(title: string, project: string | undefined, workdir: string | undefined, gitRemote: string | undefined, gitBranch: string | undefined, gitCommit: string | undefined, producer: string, model: string | undefined, startedAt: string | undefined, endedAt: string | undefined, tags: Array<string>) {
        this._title = title
        this._project = project
        this._workdir = workdir
        this._gitRemote = gitRemote
        this._gitBranch = gitBranch
        this._gitCommit = gitCommit
        this._producer = producer
        this._model = model
        this._startedAt = startedAt
        this._endedAt = endedAt
        this._tags = tags
    }

    public get title(): string {
        return this._title;
    }
    public get project(): string | undefined {
        return this._project;
    }
    public get workdir(): string | undefined {
        return this._workdir;
    }
    public get gitRemote(): string | undefined {
        return this._gitRemote;
    }
    public get gitBranch(): string | undefined {
        return this._gitBranch;
    }
    public get gitCommit(): string | undefined {
        return this._gitCommit;
    }
    public get producer(): string {
        return this._producer;
    }
    public get model(): string | undefined {
        return this._model;
    }
    public get startedAt(): string | undefined {
        return this._startedAt;
    }
    public get endedAt(): string | undefined {
        return this._endedAt;
    }
    public get tags(): Array<string> {
        return this._tags;
    }

    public toJSON(): Record<string, unknown> {
        return {
            title: this._title,
            project: this._project !== undefined ? this._project : undefined,
            workdir: this._workdir !== undefined ? this._workdir : undefined,
            gitRemote: this._gitRemote !== undefined ? this._gitRemote : undefined,
            gitBranch: this._gitBranch !== undefined ? this._gitBranch : undefined,
            gitCommit: this._gitCommit !== undefined ? this._gitCommit : undefined,
            producer: this._producer,
            model: this._model !== undefined ? this._model : undefined,
            startedAt: this._startedAt !== undefined ? this._startedAt : undefined,
            endedAt: this._endedAt !== undefined ? this._endedAt : undefined,
            tags: this._tags
        };
    }

    public with(overrides: {title?: string; project?: string | undefined; workdir?: string | undefined; gitRemote?: string | undefined; gitBranch?: string | undefined; gitCommit?: string | undefined; producer?: string; model?: string | undefined; startedAt?: string | undefined; endedAt?: string | undefined; tags?: Array<string>}): Metadata {
        return new Metadata(
            'title' in overrides ? overrides.title! : this._title,
            'project' in overrides ? overrides.project! : this._project,
            'workdir' in overrides ? overrides.workdir! : this._workdir,
            'gitRemote' in overrides ? overrides.gitRemote! : this._gitRemote,
            'gitBranch' in overrides ? overrides.gitBranch! : this._gitBranch,
            'gitCommit' in overrides ? overrides.gitCommit! : this._gitCommit,
            'producer' in overrides ? overrides.producer! : this._producer,
            'model' in overrides ? overrides.model! : this._model,
            'startedAt' in overrides ? overrides.startedAt! : this._startedAt,
            'endedAt' in overrides ? overrides.endedAt! : this._endedAt,
            'tags' in overrides ? overrides.tags! : this._tags
        );
    }

    public static fromPlain(obj: {title: string; project: string | undefined; workdir: string | undefined; gitRemote: string | undefined; gitBranch: string | undefined; gitCommit: string | undefined; producer: string; model: string | undefined; startedAt: string | undefined; endedAt: string | undefined; tags: Array<string>}): Metadata {
        return new Metadata(
            obj.title,
            obj.project,
            obj.workdir,
            obj.gitRemote,
            obj.gitBranch,
            obj.gitCommit,
            obj.producer,
            obj.model,
            obj.startedAt,
            obj.endedAt,
            obj.tags
        );
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return Metadata.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Metadata.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Metadata'
    public baboonTypeIdentifier() {
        return Metadata.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return Metadata.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return Metadata.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Metadata.BaboonMinReaderVersions
    }
    public static jsonCodec(): Metadata_JsonCodec {
        return Metadata_JsonCodec.instance
    }
}

/** @deprecated Version 1.5.0 is deprecated, you should migrate to 1.7.0 */
export class Metadata_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Metadata): unknown {
        if (this !== Metadata_JsonCodec.lazyInstance.value) {
          return Metadata_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "title": value.title,
            "project": value.project === undefined ? null : value.project,
            "workdir": value.workdir === undefined ? null : value.workdir,
            "gitRemote": value.gitRemote === undefined ? null : value.gitRemote,
            "gitBranch": value.gitBranch === undefined ? null : value.gitBranch,
            "gitCommit": value.gitCommit === undefined ? null : value.gitCommit,
            "producer": value.producer,
            "model": value.model === undefined ? null : value.model,
            "startedAt": value.startedAt === undefined ? null : value.startedAt,
            "endedAt": value.endedAt === undefined ? null : value.endedAt,
            "tags": Array.from(value.tags),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Metadata {
        if (this !== Metadata_JsonCodec .lazyInstance.value) {
            return Metadata_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Metadata (
            obj["title"] as string,
            obj["project"] === undefined || obj["project"] === null ? undefined : obj["project"] === undefined || obj["project"] === null ? undefined : obj["project"] as string,
            obj["workdir"] === undefined || obj["workdir"] === null ? undefined : obj["workdir"] === undefined || obj["workdir"] === null ? undefined : obj["workdir"] as string,
            obj["gitRemote"] === undefined || obj["gitRemote"] === null ? undefined : obj["gitRemote"] === undefined || obj["gitRemote"] === null ? undefined : obj["gitRemote"] as string,
            obj["gitBranch"] === undefined || obj["gitBranch"] === null ? undefined : obj["gitBranch"] === undefined || obj["gitBranch"] === null ? undefined : obj["gitBranch"] as string,
            obj["gitCommit"] === undefined || obj["gitCommit"] === null ? undefined : obj["gitCommit"] === undefined || obj["gitCommit"] === null ? undefined : obj["gitCommit"] as string,
            obj["producer"] as string,
            obj["model"] === undefined || obj["model"] === null ? undefined : obj["model"] === undefined || obj["model"] === null ? undefined : obj["model"] as string,
            obj["startedAt"] === undefined || obj["startedAt"] === null ? undefined : obj["startedAt"] === undefined || obj["startedAt"] === null ? undefined : obj["startedAt"] as string,
            obj["endedAt"] === undefined || obj["endedAt"] === null ? undefined : obj["endedAt"] === undefined || obj["endedAt"] === null ? undefined : obj["endedAt"] as string,
            (obj["tags"] as unknown[]).map(item => item as string),
        )
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return Metadata_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Metadata_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Metadata'
    public baboonTypeIdentifier() {
        return Metadata_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Metadata_JsonCodec())
    public static get instance(): Metadata_JsonCodec {
        return Metadata_JsonCodec.lazyInstance.value
    }
}