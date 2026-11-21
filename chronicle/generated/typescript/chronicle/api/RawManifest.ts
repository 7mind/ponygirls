import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {RawFileInfo, RawFileInfo_JsonCodec} from './RawFileInfo.js'

export class RawManifest implements BaboonGeneratedLatest {
    private readonly _sessionId: string;
    private readonly _revision: number;
    private readonly _files: Array<RawFileInfo>;

    constructor(sessionId: string, revision: number, files: Array<RawFileInfo>) {
        this._sessionId = sessionId
        this._revision = revision
        this._files = files
    }

    public get sessionId(): string {
        return this._sessionId;
    }
    public get revision(): number {
        return this._revision;
    }
    public get files(): Array<RawFileInfo> {
        return this._files;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sessionId: this._sessionId,
            revision: this._revision,
            files: this._files
        };
    }

    public with(overrides: {sessionId?: string; revision?: number; files?: Array<RawFileInfo>}): RawManifest {
        return new RawManifest(
            'sessionId' in overrides ? overrides.sessionId! : this._sessionId,
            'revision' in overrides ? overrides.revision! : this._revision,
            'files' in overrides ? overrides.files! : this._files
        );
    }

    public static fromPlain(obj: {sessionId: string; revision: number; files: Array<RawFileInfo>}): RawManifest {
        return new RawManifest(
            obj.sessionId,
            obj.revision,
            obj.files
        );
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return RawManifest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RawManifest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RawManifest'
    public baboonTypeIdentifier() {
        return RawManifest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.9.0"]
    public baboonSameInVersions() {
        return RawManifest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.9.0": "identical" }
    public baboonForwardReadable() {
        return RawManifest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.9.0", "prefix-compact": "1.9.0", "prefix-any-mode": "1.9.0", "identical": "1.9.0" }
    public baboonMinReaderVersions() {
        return RawManifest.BaboonMinReaderVersions
    }
    public static jsonCodec(): RawManifest_JsonCodec {
        return RawManifest_JsonCodec.instance
    }
}

export class RawManifest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RawManifest): unknown {
        if (this !== RawManifest_JsonCodec.lazyInstance.value) {
          return RawManifest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sessionId": value.sessionId,
            "revision": value.revision,
            "files": Array.from(value.files).map(item => RawFileInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RawManifest {
        if (this !== RawManifest_JsonCodec .lazyInstance.value) {
            return RawManifest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RawManifest (
            obj["sessionId"] as string,
            obj["revision"] as number,
            (obj["files"] as unknown[]).map(item => RawFileInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return RawManifest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RawManifest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RawManifest'
    public baboonTypeIdentifier() {
        return RawManifest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RawManifest_JsonCodec())
    public static get instance(): RawManifest_JsonCodec {
        return RawManifest_JsonCodec.lazyInstance.value
    }
}