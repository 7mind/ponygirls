import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ArtifactState, ArtifactState_JsonCodec} from './ArtifactState.js'
import {FileProgress, FileProgress_JsonCodec} from './FileProgress.js'

export class UploadStatus implements BaboonGeneratedLatest {
    private readonly _artifactId: string;
    private readonly _state: ArtifactState;
    private readonly _chunkBytes: number;
    private readonly _files: Array<FileProgress>;

    constructor(artifactId: string, state: ArtifactState, chunkBytes: number, files: Array<FileProgress>) {
        this._artifactId = artifactId
        this._state = state
        this._chunkBytes = chunkBytes
        this._files = files
    }

    public get artifactId(): string {
        return this._artifactId;
    }
    public get state(): ArtifactState {
        return this._state;
    }
    public get chunkBytes(): number {
        return this._chunkBytes;
    }
    public get files(): Array<FileProgress> {
        return this._files;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifactId: this._artifactId,
            state: this._state,
            chunkBytes: this._chunkBytes,
            files: this._files
        };
    }

    public with(overrides: {artifactId?: string; state?: ArtifactState; chunkBytes?: number; files?: Array<FileProgress>}): UploadStatus {
        return new UploadStatus(
            'artifactId' in overrides ? overrides.artifactId! : this._artifactId,
            'state' in overrides ? overrides.state! : this._state,
            'chunkBytes' in overrides ? overrides.chunkBytes! : this._chunkBytes,
            'files' in overrides ? overrides.files! : this._files
        );
    }

    public static fromPlain(obj: {artifactId: string; state: ArtifactState; chunkBytes: number; files: Array<FileProgress>}): UploadStatus {
        return new UploadStatus(
            obj.artifactId,
            obj.state,
            obj.chunkBytes,
            obj.files
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return UploadStatus.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return UploadStatus.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#UploadStatus'
    public baboonTypeIdentifier() {
        return UploadStatus.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return UploadStatus.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return UploadStatus.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return UploadStatus.BaboonMinReaderVersions
    }
    public static jsonCodec(): UploadStatus_JsonCodec {
        return UploadStatus_JsonCodec.instance
    }
}

export class UploadStatus_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: UploadStatus): unknown {
        if (this !== UploadStatus_JsonCodec.lazyInstance.value) {
          return UploadStatus_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifactId": value.artifactId,
            "state": ArtifactState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.state),
            "chunkBytes": value.chunkBytes,
            "files": Array.from(value.files).map(item => FileProgress_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): UploadStatus {
        if (this !== UploadStatus_JsonCodec .lazyInstance.value) {
            return UploadStatus_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new UploadStatus (
            obj["artifactId"] as string,
            ArtifactState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]),
            obj["chunkBytes"] as number,
            (obj["files"] as unknown[]).map(item => FileProgress_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return UploadStatus_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return UploadStatus_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#UploadStatus'
    public baboonTypeIdentifier() {
        return UploadStatus_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new UploadStatus_JsonCodec())
    public static get instance(): UploadStatus_JsonCodec {
        return UploadStatus_JsonCodec.lazyInstance.value
    }
}