import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ArtifactKind, ArtifactKind_JsonCodec} from './ArtifactKind.js'
import {Visibility, Visibility_JsonCodec} from './Visibility.js'

export class SearchFilter implements BaboonGeneratedLatest {
    private readonly _visibility: Visibility | undefined;
    private readonly _kind: ArtifactKind | undefined;
    private readonly _createdByUser: string | undefined;
    private readonly _tags: Array<string>;
    private readonly _hostname: string | undefined;
    private readonly _projectPath: string | undefined;

    constructor(visibility: Visibility | undefined, kind: ArtifactKind | undefined, createdByUser: string | undefined, tags: Array<string>, hostname: string | undefined, projectPath: string | undefined) {
        this._visibility = visibility
        this._kind = kind
        this._createdByUser = createdByUser
        this._tags = tags
        this._hostname = hostname
        this._projectPath = projectPath
    }

    public get visibility(): Visibility | undefined {
        return this._visibility;
    }
    public get kind(): ArtifactKind | undefined {
        return this._kind;
    }
    public get createdByUser(): string | undefined {
        return this._createdByUser;
    }
    public get tags(): Array<string> {
        return this._tags;
    }
    public get hostname(): string | undefined {
        return this._hostname;
    }
    public get projectPath(): string | undefined {
        return this._projectPath;
    }

    public toJSON(): Record<string, unknown> {
        return {
            visibility: this._visibility !== undefined ? this._visibility : undefined,
            kind: this._kind !== undefined ? this._kind : undefined,
            createdByUser: this._createdByUser !== undefined ? this._createdByUser : undefined,
            tags: this._tags,
            hostname: this._hostname !== undefined ? this._hostname : undefined,
            projectPath: this._projectPath !== undefined ? this._projectPath : undefined
        };
    }

    public with(overrides: {visibility?: Visibility | undefined; kind?: ArtifactKind | undefined; createdByUser?: string | undefined; tags?: Array<string>; hostname?: string | undefined; projectPath?: string | undefined}): SearchFilter {
        return new SearchFilter(
            'visibility' in overrides ? overrides.visibility! : this._visibility,
            'kind' in overrides ? overrides.kind! : this._kind,
            'createdByUser' in overrides ? overrides.createdByUser! : this._createdByUser,
            'tags' in overrides ? overrides.tags! : this._tags,
            'hostname' in overrides ? overrides.hostname! : this._hostname,
            'projectPath' in overrides ? overrides.projectPath! : this._projectPath
        );
    }

    public static fromPlain(obj: {visibility: Visibility | undefined; kind: ArtifactKind | undefined; createdByUser: string | undefined; tags: Array<string>; hostname: string | undefined; projectPath: string | undefined}): SearchFilter {
        return new SearchFilter(
            obj.visibility,
            obj.kind,
            obj.createdByUser,
            obj.tags,
            obj.hostname,
            obj.projectPath
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchFilter.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return SearchFilter.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#SearchFilter'
    public baboonTypeIdentifier() {
        return SearchFilter.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return SearchFilter.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
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

export class SearchFilter_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SearchFilter): unknown {
        if (this !== SearchFilter_JsonCodec.lazyInstance.value) {
          return SearchFilter_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "visibility": value.visibility === undefined ? null : Visibility_JsonCodec.instance.encode(BaboonCodecContext.Default, value.visibility),
            "kind": value.kind === undefined ? null : ArtifactKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
            "createdByUser": value.createdByUser === undefined ? null : value.createdByUser,
            "tags": Array.from(value.tags),
            "hostname": value.hostname === undefined ? null : value.hostname,
            "projectPath": value.projectPath === undefined ? null : value.projectPath,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SearchFilter {
        if (this !== SearchFilter_JsonCodec .lazyInstance.value) {
            return SearchFilter_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SearchFilter (
            obj["visibility"] === undefined || obj["visibility"] === null ? undefined : obj["visibility"] === undefined || obj["visibility"] === null ? undefined : Visibility_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["visibility"]),
            obj["kind"] === undefined || obj["kind"] === null ? undefined : obj["kind"] === undefined || obj["kind"] === null ? undefined : ArtifactKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]),
            obj["createdByUser"] === undefined || obj["createdByUser"] === null ? undefined : obj["createdByUser"] === undefined || obj["createdByUser"] === null ? undefined : obj["createdByUser"] as string,
            (obj["tags"] as unknown[]).map(item => item as string),
            obj["hostname"] === undefined || obj["hostname"] === null ? undefined : obj["hostname"] === undefined || obj["hostname"] === null ? undefined : obj["hostname"] as string,
            obj["projectPath"] === undefined || obj["projectPath"] === null ? undefined : obj["projectPath"] === undefined || obj["projectPath"] === null ? undefined : obj["projectPath"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchFilter_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return SearchFilter_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#SearchFilter'
    public baboonTypeIdentifier() {
        return SearchFilter_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SearchFilter_JsonCodec())
    public static get instance(): SearchFilter_JsonCodec {
        return SearchFilter_JsonCodec.lazyInstance.value
    }
}