import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class Summary implements BaboonGeneratedLatest {
    private readonly _key: string;
    private readonly _project: string;
    private readonly _item: string;
    private readonly _revision: number;
    private readonly _title: string;
    private readonly _docType: string;
    private readonly _status: string;
    private readonly _importance: string;
    private readonly _humanAttention: string;
    private readonly _tags: Array<string>;
    private readonly _modifiedAt: string;
    private readonly _modifiedBy: string;

    constructor(key: string, project: string, item: string, revision: number, title: string, docType: string, status: string, importance: string, humanAttention: string, tags: Array<string>, modifiedAt: string, modifiedBy: string) {
        this._key = key
        this._project = project
        this._item = item
        this._revision = revision
        this._title = title
        this._docType = docType
        this._status = status
        this._importance = importance
        this._humanAttention = humanAttention
        this._tags = tags
        this._modifiedAt = modifiedAt
        this._modifiedBy = modifiedBy
    }

    public get key(): string {
        return this._key;
    }
    public get project(): string {
        return this._project;
    }
    public get item(): string {
        return this._item;
    }
    public get revision(): number {
        return this._revision;
    }
    public get title(): string {
        return this._title;
    }
    public get docType(): string {
        return this._docType;
    }
    public get status(): string {
        return this._status;
    }
    public get importance(): string {
        return this._importance;
    }
    public get humanAttention(): string {
        return this._humanAttention;
    }
    public get tags(): Array<string> {
        return this._tags;
    }
    public get modifiedAt(): string {
        return this._modifiedAt;
    }
    public get modifiedBy(): string {
        return this._modifiedBy;
    }

    public toJSON(): Record<string, unknown> {
        return {
            key: this._key,
            project: this._project,
            item: this._item,
            revision: this._revision,
            title: this._title,
            docType: this._docType,
            status: this._status,
            importance: this._importance,
            humanAttention: this._humanAttention,
            tags: this._tags,
            modifiedAt: this._modifiedAt,
            modifiedBy: this._modifiedBy
        };
    }

    public with(overrides: {key?: string; project?: string; item?: string; revision?: number; title?: string; docType?: string; status?: string; importance?: string; humanAttention?: string; tags?: Array<string>; modifiedAt?: string; modifiedBy?: string}): Summary {
        return new Summary(
            'key' in overrides ? overrides.key! : this._key,
            'project' in overrides ? overrides.project! : this._project,
            'item' in overrides ? overrides.item! : this._item,
            'revision' in overrides ? overrides.revision! : this._revision,
            'title' in overrides ? overrides.title! : this._title,
            'docType' in overrides ? overrides.docType! : this._docType,
            'status' in overrides ? overrides.status! : this._status,
            'importance' in overrides ? overrides.importance! : this._importance,
            'humanAttention' in overrides ? overrides.humanAttention! : this._humanAttention,
            'tags' in overrides ? overrides.tags! : this._tags,
            'modifiedAt' in overrides ? overrides.modifiedAt! : this._modifiedAt,
            'modifiedBy' in overrides ? overrides.modifiedBy! : this._modifiedBy
        );
    }

    public static fromPlain(obj: {key: string; project: string; item: string; revision: number; title: string; docType: string; status: string; importance: string; humanAttention: string; tags: Array<string>; modifiedAt: string; modifiedBy: string}): Summary {
        return new Summary(
            obj.key,
            obj.project,
            obj.item,
            obj.revision,
            obj.title,
            obj.docType,
            obj.status,
            obj.importance,
            obj.humanAttention,
            obj.tags,
            obj.modifiedAt,
            obj.modifiedBy
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Summary.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return Summary.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#Summary'
    public baboonTypeIdentifier() {
        return Summary.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Summary.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Summary.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Summary.BaboonMinReaderVersions
    }
    public static jsonCodec(): Summary_JsonCodec {
        return Summary_JsonCodec.instance
    }
}

export class Summary_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Summary): unknown {
        if (this !== Summary_JsonCodec.lazyInstance.value) {
          return Summary_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "key": value.key,
            "project": value.project,
            "item": value.item,
            "revision": value.revision,
            "title": value.title,
            "docType": value.docType,
            "status": value.status,
            "importance": value.importance,
            "humanAttention": value.humanAttention,
            "tags": Array.from(value.tags),
            "modifiedAt": value.modifiedAt,
            "modifiedBy": value.modifiedBy,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Summary {
        if (this !== Summary_JsonCodec .lazyInstance.value) {
            return Summary_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Summary (
            obj["key"] as string,
            obj["project"] as string,
            obj["item"] as string,
            obj["revision"] as number,
            obj["title"] as string,
            obj["docType"] as string,
            obj["status"] as string,
            obj["importance"] as string,
            obj["humanAttention"] as string,
            (obj["tags"] as unknown[]).map(item => item as string),
            obj["modifiedAt"] as string,
            obj["modifiedBy"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Summary_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return Summary_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#Summary'
    public baboonTypeIdentifier() {
        return Summary_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Summary_JsonCodec())
    public static get instance(): Summary_JsonCodec {
        return Summary_JsonCodec.lazyInstance.value
    }
}