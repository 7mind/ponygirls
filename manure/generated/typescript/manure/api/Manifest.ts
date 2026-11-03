import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ArtifactState, ArtifactState_JsonCodec} from './ArtifactState.js'
import {ManifestEntry, ManifestEntry_JsonCodec} from './ManifestEntry.js'

export class Manifest implements BaboonGeneratedLatest {
    private readonly _artifactId: string;
    private readonly _state: ArtifactState;
    private readonly _files: Array<ManifestEntry>;

    constructor(artifactId: string, state: ArtifactState, files: Array<ManifestEntry>) {
        this._artifactId = artifactId
        this._state = state
        this._files = files
    }

    public get artifactId(): string {
        return this._artifactId;
    }
    public get state(): ArtifactState {
        return this._state;
    }
    public get files(): Array<ManifestEntry> {
        return this._files;
    }

    public toJSON(): Record<string, unknown> {
        return {
            artifactId: this._artifactId,
            state: this._state,
            files: this._files
        };
    }

    public with(overrides: {artifactId?: string; state?: ArtifactState; files?: Array<ManifestEntry>}): Manifest {
        return new Manifest(
            'artifactId' in overrides ? overrides.artifactId! : this._artifactId,
            'state' in overrides ? overrides.state! : this._state,
            'files' in overrides ? overrides.files! : this._files
        );
    }

    public static fromPlain(obj: {artifactId: string; state: ArtifactState; files: Array<ManifestEntry>}): Manifest {
        return new Manifest(
            obj.artifactId,
            obj.state,
            obj.files
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Manifest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Manifest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#Manifest'
    public baboonTypeIdentifier() {
        return Manifest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return Manifest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return Manifest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Manifest.BaboonMinReaderVersions
    }
    public static jsonCodec(): Manifest_JsonCodec {
        return Manifest_JsonCodec.instance
    }
}

export class Manifest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Manifest): unknown {
        if (this !== Manifest_JsonCodec.lazyInstance.value) {
          return Manifest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "artifactId": value.artifactId,
            "state": ArtifactState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.state),
            "files": Array.from(value.files).map(item => ManifestEntry_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Manifest {
        if (this !== Manifest_JsonCodec .lazyInstance.value) {
            return Manifest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Manifest (
            obj["artifactId"] as string,
            ArtifactState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]),
            (obj["files"] as unknown[]).map(item => ManifestEntry_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return Manifest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return Manifest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#Manifest'
    public baboonTypeIdentifier() {
        return Manifest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Manifest_JsonCodec())
    public static get instance(): Manifest_JsonCodec {
        return Manifest_JsonCodec.lazyInstance.value
    }
}