import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {ArtifactKind, ArtifactKind_JsonCodec} from './ArtifactKind.js'
import {ArtifactState, ArtifactState_JsonCodec} from './ArtifactState.js'
import {Visibility, Visibility_JsonCodec} from './Visibility.js'

export class Artifact implements BaboonGeneratedLatest {
    private readonly _artifactId: string;
    private readonly _name: string;
    private readonly _kind: ArtifactKind;
    private readonly _visibility: Visibility;
    private readonly _state: ArtifactState;
    private readonly _createdByUser: string;
    private readonly _createdAt: string;
    private readonly _expiresAt: string | undefined;
    private readonly _totalBytes: bigint;
    private readonly _fileCount: number;
    private readonly _contentUrl: string;
    private readonly _tags: Array<string>;
    private readonly _hostname: string | undefined;
    private readonly _projectPath: string | undefined;

    constructor(artifactId: string, name: string, kind: ArtifactKind, visibility: Visibility, state: ArtifactState, createdByUser: string, createdAt: string, expiresAt: string | undefined, totalBytes: bigint, fileCount: number, contentUrl: string, tags: Array<string>, hostname: string | undefined, projectPath: string | undefined) {
        this._artifactId = artifactId
        this._name = name
        this._kind = kind
        this._visibility = visibility
        this._state = state
        this._createdByUser = createdByUser
        this._createdAt = createdAt
        this._expiresAt = expiresAt
        this._totalBytes = totalBytes
        this._fileCount = fileCount
        this._contentUrl = contentUrl
        this._tags = tags
        this._hostname = hostname
        this._projectPath = projectPath
    }

    public get artifactId(): string {
        return this._artifactId;
    }
    public get name(): string {
        return this._name;
    }
    public get kind(): ArtifactKind {
        return this._kind;
    }
    public get visibility(): Visibility {
        return this._visibility;
    }
    public get state(): ArtifactState {
        return this._state;
    }
    public get createdByUser(): string {
        return this._createdByUser;
    }
    public get createdAt(): string {
        return this._createdAt;
    }
    public get expiresAt(): string | undefined {
        return this._expiresAt;
    }
    public get totalBytes(): bigint {
        return this._totalBytes;
    }
    public get fileCount(): number {
        return this._fileCount;
    }
    public get contentUrl(): string {
        return this._contentUrl;
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
            artifactId: this._artifactId,
            name: this._name,
            kind: this._kind,
            visibility: this._visibility,
            state: this._state,
            createdByUser: this._createdByUser,
            createdAt: this._createdAt,
            expiresAt: this._expiresAt !== undefined ? this._expiresAt : undefined,
            totalBytes: this._totalBytes,
            fileCount: this._fileCount,
            contentUrl: this._contentUrl,
            tags: this._tags,
            hostname: this._hostname !== undefined ? this._hostname : undefined,
            projectPath: this._projectPath !== undefined ? this._projectPath : undefined
        };
    }

    public with(overrides: {artifactId?: string; name?: string; kind?: ArtifactKind; visibility?: Visibility; state?: ArtifactState; createdByUser?: string; createdAt?: string; expiresAt?: string | undefined; totalBytes?: bigint; fileCount?: number; contentUrl?: string; tags?: Array<string>; hostname?: string | undefined; projectPath?: string | undefined}): Artifact {
        return new Artifact(
            'artifactId' in overrides ? overrides.artifactId! : this._artifactId,
            'name' in overrides ? overrides.name! : this._name,
            'kind' in overrides ? overrides.kind! : this._kind,
            'visibility' in overrides ? overrides.visibility! : this._visibility,
            'state' in overrides ? overrides.state! : this._state,
            'createdByUser' in overrides ? overrides.createdByUser! : this._createdByUser,
            'createdAt' in overrides ? overrides.createdAt! : this._createdAt,
            'expiresAt' in overrides ? overrides.expiresAt! : this._expiresAt,
            'totalBytes' in overrides ? overrides.totalBytes! : this._totalBytes,
            'fileCount' in overrides ? overrides.fileCount! : this._fileCount,
            'contentUrl' in overrides ? overrides.contentUrl! : this._contentUrl,
            'tags' in overrides ? overrides.tags! : this._tags,
            'hostname' in overrides ? overrides.hostname! : this._hostname,
            'projectPath' in overrides ? overrides.projectPath! : this._projectPath
        );
    }

    public static fromPlain(obj: {artifactId: string; name: string; kind: ArtifactKind; visibility: Visibility; state: ArtifactState; createdByUser: string; createdAt: string; expiresAt: string | undefined; totalBytes: bigint; fileCount: number; contentUrl: string; tags: Array<string>; hostname: string | undefined; projectPath: string | undefined}): Artifact {
        return new Artifact(
            obj.artifactId,
            obj.name,
            obj.kind,
            obj.visibility,
            obj.state,
            obj.createdByUser,
            obj.createdAt,
            obj.expiresAt,
            obj.totalBytes,
            obj.fileCount,
            obj.contentUrl,
            obj.tags,
            obj.hostname,
            obj.projectPath
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Artifact.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Artifact.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#Artifact'
    public baboonTypeIdentifier() {
        return Artifact.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Artifact.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Artifact.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Artifact.BaboonMinReaderVersions
    }
    public static jsonCodec(): Artifact_JsonCodec {
        return Artifact_JsonCodec.instance
    }
}

export class Artifact_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Artifact): unknown {
        if (this !== Artifact_JsonCodec.lazyInstance.value) {
          return Artifact_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifactId": value.artifactId,
            "name": value.name,
            "kind": ArtifactKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.kind),
            "visibility": Visibility_JsonCodec.instance.encode(BaboonCodecContext.Default, value.visibility),
            "state": ArtifactState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.state),
            "createdByUser": value.createdByUser,
            "createdAt": value.createdAt,
            "expiresAt": value.expiresAt === undefined ? null : value.expiresAt,
            "totalBytes": value.totalBytes.toString(),
            "fileCount": value.fileCount,
            "contentUrl": value.contentUrl,
            "tags": Array.from(value.tags),
            "hostname": value.hostname === undefined ? null : value.hostname,
            "projectPath": value.projectPath === undefined ? null : value.projectPath,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Artifact {
        if (this !== Artifact_JsonCodec .lazyInstance.value) {
            return Artifact_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Artifact (
            obj["artifactId"] as string,
            obj["name"] as string,
            ArtifactKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["kind"]),
            Visibility_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["visibility"]),
            ArtifactState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]),
            obj["createdByUser"] as string,
            obj["createdAt"] as string,
            obj["expiresAt"] === undefined || obj["expiresAt"] === null ? undefined : obj["expiresAt"] === undefined || obj["expiresAt"] === null ? undefined : obj["expiresAt"] as string,
            BaboonInt64.read(obj["totalBytes"], "i64/u64"),
            obj["fileCount"] as number,
            obj["contentUrl"] as string,
            (obj["tags"] as unknown[]).map(item => item as string),
            obj["hostname"] === undefined || obj["hostname"] === null ? undefined : obj["hostname"] === undefined || obj["hostname"] === null ? undefined : obj["hostname"] as string,
            obj["projectPath"] === undefined || obj["projectPath"] === null ? undefined : obj["projectPath"] === undefined || obj["projectPath"] === null ? undefined : obj["projectPath"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Artifact_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Artifact_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#Artifact'
    public baboonTypeIdentifier() {
        return Artifact_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Artifact_JsonCodec())
    public static get instance(): Artifact_JsonCodec {
        return Artifact_JsonCodec.lazyInstance.value
    }
}