import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class RawFile implements BaboonGenerated {
    private readonly _path: string;
    private readonly _sha256: string;
    private readonly _content: string;

    constructor(path: string, sha256: string, content: string) {
        this._path = path
        this._sha256 = sha256
        this._content = content
    }

    public get path(): string {
        return this._path;
    }
    public get sha256(): string {
        return this._sha256;
    }
    public get content(): string {
        return this._content;
    }

    public toJSON(): Record<string, unknown> {
        return {
            path: this._path,
            sha256: this._sha256,
            content: this._content
        };
    }

    public with(overrides: {path?: string; sha256?: string; content?: string}): RawFile {
        return new RawFile(
            'path' in overrides ? overrides.path! : this._path,
            'sha256' in overrides ? overrides.sha256! : this._sha256,
            'content' in overrides ? overrides.content! : this._content
        );
    }

    public static fromPlain(obj: {path: string; sha256: string; content: string}): RawFile {
        return new RawFile(
            obj.path,
            obj.sha256,
            obj.content
        );
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return RawFile.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RawFile.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RawFile'
    public baboonTypeIdentifier() {
        return RawFile.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return RawFile.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.2.0": "identical", "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return RawFile.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return RawFile.BaboonMinReaderVersions
    }
    public static jsonCodec(): RawFile_JsonCodec {
        return RawFile_JsonCodec.instance
    }
}

/** @deprecated Version 1.2.0 is deprecated, you should migrate to 1.8.0 */
export class RawFile_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RawFile): unknown {
        if (this !== RawFile_JsonCodec.lazyInstance.value) {
          return RawFile_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "path": value.path,
            "sha256": value.sha256,
            "content": value.content,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RawFile {
        if (this !== RawFile_JsonCodec .lazyInstance.value) {
            return RawFile_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RawFile (
            obj["path"] as string,
            obj["sha256"] as string,
            obj["content"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return RawFile_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return RawFile_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#RawFile'
    public baboonTypeIdentifier() {
        return RawFile_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RawFile_JsonCodec())
    public static get instance(): RawFile_JsonCodec {
        return RawFile_JsonCodec.lazyInstance.value
    }
}